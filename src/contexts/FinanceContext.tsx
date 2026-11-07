'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage, getAuthState } from '../services/auth';
import { createFinanceApi } from '../services/finance';
import type { FinanceSettings, FinanceSettingsUpdate, SpendingInput } from '../services/finance';
import type { Income, IncomeInput, Plan, PlanExceptionInput, PlanInput, Spending } from '../types';
import { DEFAULT_BUDGET_PERIOD, DEFAULT_SHOW_BY } from '../lib/periods';
import { isValidTimeZone, projectPlans, type PlanOccurrence } from '../lib/plans';

interface FinanceContextValue {
  settings: FinanceSettings;
  spendings: Spending[];
  incomes: Income[];
  plans: Plan[];
  loading: boolean;
  hasLoaded: boolean;
  error: string | null;
  reload: () => Promise<void>;
  fetchWeeksSpendings: (startDate: string, endDate: string) => Promise<Spending[]>;
  updateSettings: (updates: FinanceSettingsUpdate) => Promise<void>;
  createSpending: (input: SpendingInput) => Promise<Spending>;
  updateSpending: (id: string, input: SpendingInput) => Promise<void>;
  deleteSpending: (id: string) => Promise<void>;
  createIncome: (input: IncomeInput) => Promise<void>;
  updateIncome: (id: string, input: IncomeInput) => Promise<void>;
  deleteIncome: (id: string) => Promise<void>;
  /** Planned occurrences in [from, to] (YYYY-MM-DD) that are not real spendings yet. */
  projectedBetween: (from: string, to: string) => PlanOccurrence[];
  createPlan: (input: PlanInput) => Promise<Plan>;
  updatePlan: (id: string, input: PlanInput) => Promise<Plan>;
  splitPlan: (id: string, input: PlanInput) => Promise<Plan>;
  deletePlan: (id: string) => Promise<void>;
  setPlanException: (id: string, date: string, input: PlanExceptionInput) => Promise<void>;
  clearPlanException: (id: string, date: string) => Promise<void>;
  /** "Done now": records an upcoming occurrence as a real spending right away. */
  completePlanOccurrence: (id: string, date: string) => Promise<Spending>;
}

const FinanceContext = createContext<FinanceContextValue | undefined>(undefined);
const api = createFinanceApi();
const emptySettings: FinanceSettings = {
  avatar: '', categories: [], budgetPeriod: DEFAULT_BUDGET_PERIOD, showBy: DEFAULT_SHOW_BY,
};

export function FinanceProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [settings, setSettings] = useState<FinanceSettings>(emptySettings);
  const [spendings, setSpendings] = useState<Spending[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const watermarks = useRef<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const loaded = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const reloadFlight = useRef<Promise<void> | null>(null);
  const inFlightRanges = useRef<Map<string, Promise<Spending[]>>>(new Map());

  const currentAccount = useCallback(() => mounted.current && getAuthState().user?.id === userId, [userId]);

  // Keep reloads and writes ordered so an older GET cannot overwrite a saved transaction.
  const serialize = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.current.then(async () => {
      if (!currentAccount()) throw new Error('Your account session changed. Please sign in again.');
      return operation();
    });
    queue.current = result.catch(() => {});
    return result;
  }, [currentAccount]);

  const fetchWeeksSpendings = useCallback((startDate: string, endDate: string): Promise<Spending[]> => {
    const rangeKey = `${startDate}:${endDate}`;
    const existing = inFlightRanges.current.get(rangeKey);
    if (existing) return existing;

    const promise = api.getSpendings({ startDate, endDate })
      .then((rangeSpendings) => {
        if (currentAccount() && rangeSpendings.length > 0) {
          setSpendings((prev) => {
            const byId = new Map<string, Spending>();
            for (const item of prev) byId.set(item.id, item);
            for (const item of rangeSpendings) byId.set(item.id, item);
            return [...byId.values()];
          });
        }
        return rangeSpendings;
      })
      .finally(() => {
        inFlightRanges.current.delete(rangeKey);
      });

    inFlightRanges.current.set(rangeKey, promise);
    return promise;
  }, [currentAccount]);

  const reload = useCallback((): Promise<void> => {
    if (reloadFlight.current) return reloadFlight.current;
    reloadFlight.current = serialize(async () => {
      if (!loaded.current) setLoading(true);
      try {
        const [loadedSettings, nextIncomes, nextPlans] = await Promise.all([
          api.getSettings(), api.getIncomes(), api.getPlans(),
        ]);
        if (!currentAccount()) return;
        // Plans become real at their local time, so the server needs this device's zone.
        let nextSettings = loadedSettings;
        const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (deviceZone && isValidTimeZone(deviceZone) && loadedSettings.timezone && deviceZone !== loadedSettings.timezone) {
          nextSettings = await api.updateSettings({ timezone: deviceZone }).catch(() => loadedSettings);
        }
        // Loading plans materializes passed occurrences; pull in any that moved past a
        // previously known watermark so they never vanish between projected and real.
        const caughtUp = staleRange(watermarks.current, nextPlans);
        watermarks.current = new Map(nextPlans.map(plan => [plan.id, plan.materializedThrough]));
        if (caughtUp) {
          const fresh = await api.getSpendings(caughtUp).catch(() => []);
          if (fresh.length && currentAccount()) setSpendings(records => mergeById(records, fresh));
        }
        if (!currentAccount()) return;
        setSettings(nextSettings);
        setIncomes(nextIncomes);
        setPlans(nextPlans);
        loaded.current = true;
        setHasLoaded(true);
        setError(null);
      } catch (cause) {
        if (currentAccount()) setError(errorMessage(cause));
        throw cause;
      } finally {
        if (currentAccount()) setLoading(false);
      }
    }).finally(() => { reloadFlight.current = null; });
    return reloadFlight.current;
  }, [serialize, currentAccount]);

  useEffect(() => {
    mounted.current = true;
    void reload().catch(() => {});
    const onFocus = () => { void reload().catch(() => {}); };
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);

  const updateSettings = useCallback((updates: FinanceSettingsUpdate) => serialize(async () => {
    const saved = await api.updateSettings(updates);
    if (currentAccount()) setSettings(saved);
  }), [serialize, currentAccount]);

  const createSpending = useCallback((input: SpendingInput) => serialize(async () => {
    const saved = await api.createSpending(input);
    if (currentAccount()) setSpendings(records => [...records.filter(record => record.id !== saved.id), saved]);
    return saved;
  }), [serialize, currentAccount]);

  const updateSpending = useCallback((id: string, input: SpendingInput) => serialize(async () => {
    const saved = await api.updateSpending(id, input);
    if (currentAccount()) setSpendings(records => [...records.filter(record => record.id !== saved.id), saved]);
  }), [serialize, currentAccount]);

  const deleteSpending = useCallback((id: string) => serialize(async () => {
    await api.deleteSpending(id);
    if (currentAccount()) setSpendings(records => records.filter(record => record.id !== id));
  }), [serialize, currentAccount]);

  const createIncome = useCallback((input: IncomeInput) => serialize(async () => {
    const saved = await api.createIncome(input);
    if (currentAccount()) setIncomes(records => [...records.filter(record => record.id !== saved.id), saved]);
  }), [serialize, currentAccount]);

  const updateIncome = useCallback((id: string, input: IncomeInput) => serialize(async () => {
    const saved = await api.updateIncome(id, input);
    if (currentAccount()) setIncomes(records => [...records.filter(record => record.id !== saved.id), saved]);
  }), [serialize, currentAccount]);

  const deleteIncome = useCallback((id: string) => serialize(async () => {
    await api.deleteIncome(id);
    if (!currentAccount()) return;
    setIncomes(records => records.filter(record => record.id !== id));
    // The server resets the budget period when its paycheck income is deleted. If the refresh fails,
    // apply the same reset locally so the page never shows a paycheck period without an income.
    const fresh = await api.getSettings().catch(() => null);
    if (!currentAccount()) return;
    if (fresh) setSettings(fresh);
    else setSettings(current => current.budgetPeriod?.mode === 'paycheck' && current.budgetPeriod.paycheckIncomeId === id
      ? { ...current, budgetPeriod: { ...current.budgetPeriod, mode: 'calendar', paycheckIncomeId: null } }
      : current);
  }), [serialize, currentAccount]);

  const realPlanKeys = useMemo(() => new Set(
    spendings.filter(spending => spending.planId && spending.planDate).map(spending => `${spending.planId}|${spending.planDate}`),
  ), [spendings]);
  const projectedBetween = useCallback(
    (from: string, to: string) => projectPlans(plans, from, to, realPlanKeys),
    [plans, realPlanKeys],
  );

  const replacePlan = useCallback((saved: Plan) => {
    watermarks.current.set(saved.id, saved.materializedThrough);
    setPlans(records => records.some(record => record.id === saved.id)
      ? records.map(record => record.id === saved.id ? saved : record)
      : [...records, saved]);
  }, []);

  const createPlan = useCallback((input: PlanInput) => serialize(async () => {
    const saved = await api.createPlan(input);
    if (currentAccount()) replacePlan(saved);
    return saved;
  }), [serialize, currentAccount, replacePlan]);

  const updatePlan = useCallback((id: string, input: PlanInput) => serialize(async () => {
    const saved = await api.updatePlan(id, input);
    if (currentAccount()) replacePlan(saved);
    return saved;
  }), [serialize, currentAccount, replacePlan]);

  const splitPlan = useCallback((id: string, input: PlanInput) => serialize(async () => {
    const { ended, created } = await api.splitPlan(id, input);
    if (currentAccount()) { replacePlan(ended); replacePlan(created); }
    return created;
  }), [serialize, currentAccount, replacePlan]);

  const deletePlan = useCallback((id: string) => serialize(async () => {
    await api.deletePlan(id);
    if (!currentAccount()) return;
    watermarks.current.delete(id);
    setPlans(records => records.filter(record => record.id !== id));
    // Past occurrences stay as ordinary spendings; the server unlinks them.
    setSpendings(records => records.map(record => record.planId === id ? { ...record, planId: null } : record));
  }), [serialize, currentAccount]);

  const setPlanException = useCallback((id: string, date: string, input: PlanExceptionInput) => serialize(async () => {
    const saved = await api.setPlanException(id, date, input);
    if (currentAccount()) replacePlan(saved);
  }), [serialize, currentAccount, replacePlan]);

  const clearPlanException = useCallback((id: string, date: string) => serialize(async () => {
    const saved = await api.deletePlanException(id, date);
    if (currentAccount()) replacePlan(saved);
  }), [serialize, currentAccount, replacePlan]);

  const completePlanOccurrence = useCallback((id: string, date: string) => serialize(async () => {
    const saved = await api.completePlanOccurrence(id, date);
    if (currentAccount()) setSpendings(records => [...records.filter(record => record.id !== saved.id), saved]);
    return saved;
  }), [serialize, currentAccount]);

  return (
    <FinanceContext.Provider value={{
      settings, spendings, incomes, plans, loading, hasLoaded, error,
      projectedBetween, createPlan, updatePlan, splitPlan, deletePlan, setPlanException, clearPlanException, completePlanOccurrence,
      reload, fetchWeeksSpendings, updateSettings, createSpending, updateSpending, deleteSpending,
      createIncome, updateIncome, deleteIncome
    }}>
      {children}
    </FinanceContext.Provider>
  );
}


function mergeById(records: Spending[], fresh: Spending[]): Spending[] {
  const byId = new Map(records.map(record => [record.id, record]));
  for (const record of fresh) byId.set(record.id, record);
  return [...byId.values()];
}

/** Date range covering every plan whose watermark advanced since the last load, or null. */
function staleRange(previous: Map<string, string>, next: Plan[]): { startDate: string; endDate: string } | null {
  let startDate: string | null = null;
  let endDate: string | null = null;
  for (const plan of next) {
    const before = previous.get(plan.id);
    if (!before || before >= plan.materializedThrough) continue;
    const from = before.slice(0, 10);
    const to = plan.materializedThrough.slice(0, 10);
    if (!startDate || from < startDate) startDate = from;
    if (!endDate || to > endDate) endDate = to;
  }
  return startDate && endDate ? { startDate, endDate } : null;
}

export function useFinance() {
  const context = useContext(FinanceContext);
  if (!context) throw new Error('useFinance must be used within a FinanceProvider');
  return context;
}
