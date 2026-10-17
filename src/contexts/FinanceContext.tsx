'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage, getAuthState } from '../services/auth';
import { createFinanceApi } from '../services/finance';
import type { FinanceSettings, SpendingInput } from '../services/finance';
import type { IncomeEntry, IncomeEntryInput, RepeatRule, RepeatRuleInput, Spending } from '../types';

interface FinanceContextValue {
  settings: FinanceSettings;
  spendings: Spending[];
  incomeEntries: IncomeEntry[];
  repeatRules: RepeatRule[];
  loading: boolean;
  hasLoaded: boolean;
  error: string | null;
  reload: () => Promise<void>;
  fetchWeeksSpendings: (startDate: string, endDate: string) => Promise<Spending[]>;
  updateSettings: (updates: Partial<FinanceSettings>) => Promise<void>;
  createSpending: (input: SpendingInput) => Promise<void>;
  updateSpending: (id: string, input: SpendingInput) => Promise<void>;
  deleteSpending: (id: string) => Promise<void>;
  createIncomeEntry: (input: IncomeEntryInput) => Promise<void>;
  updateIncomeEntry: (id: string, input: IncomeEntryInput) => Promise<void>;
  deleteIncomeEntry: (id: string) => Promise<void>;
  createRepeatRule: (input: RepeatRuleInput) => Promise<RepeatRule>;
  deleteRepeatRule: (id: string, deleteFuture?: boolean) => Promise<void>;
}

const FinanceContext = createContext<FinanceContextValue | undefined>(undefined);
const api = createFinanceApi();
const emptySettings: FinanceSettings = {
  income: 0, avatar: '', categories: [],
};

export function FinanceProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [settings, setSettings] = useState<FinanceSettings>(emptySettings);
  const [spendings, setSpendings] = useState<Spending[]>([]);
  const [incomeEntries, setIncomeEntries] = useState<IncomeEntry[]>([]);
  const [repeatRules, setRepeatRules] = useState<RepeatRule[]>([]);
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
        const [nextSettings, nextIncomeEntries, nextRepeatRules] = await Promise.all([
          api.getSettings(), api.getIncomeEntries(), api.getRepeatRules(),
        ]);
        if (!currentAccount()) return;
        setSettings(nextSettings);
        setIncomeEntries(nextIncomeEntries);
        setRepeatRules(nextRepeatRules);
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

  const updateSettings = useCallback((updates: Partial<FinanceSettings>) => serialize(async () => {
    const saved = await api.updateSettings(updates);
    if (currentAccount()) setSettings(saved);
  }), [serialize, currentAccount]);

  const createSpending = useCallback((input: SpendingInput) => serialize(async () => {
    const saved = await api.createSpending(input);
    if (currentAccount()) setSpendings(records => [...records.filter(record => record.id !== saved.id), saved]);
  }), [serialize, currentAccount]);

  const updateSpending = useCallback((id: string, input: SpendingInput) => serialize(async () => {
    const saved = await api.updateSpending(id, input);
    if (currentAccount()) setSpendings(records => [...records.filter(record => record.id !== saved.id), saved]);
  }), [serialize, currentAccount]);

  const deleteSpending = useCallback((id: string) => serialize(async () => {
    await api.deleteSpending(id);
    if (currentAccount()) setSpendings(records => records.filter(record => record.id !== id));
  }), [serialize, currentAccount]);

  const createIncomeEntry = useCallback((input: IncomeEntryInput) => serialize(async () => {
    const saved = await api.createIncomeEntry(input);
    if (currentAccount()) setIncomeEntries(records => [...records.filter(record => record.id !== saved.id), saved]);
  }), [serialize, currentAccount]);

  const updateIncomeEntry = useCallback((id: string, input: IncomeEntryInput) => serialize(async () => {
    const saved = await api.updateIncomeEntry(id, input);
    if (currentAccount()) setIncomeEntries(records => [...records.filter(record => record.id !== saved.id), saved]);
  }), [serialize, currentAccount]);

  const deleteIncomeEntry = useCallback((id: string) => serialize(async () => {
    await api.deleteIncomeEntry(id);
    if (currentAccount()) setIncomeEntries(records => records.filter(record => record.id !== id));
  }), [serialize, currentAccount]);

  const createRepeatRule = useCallback((input: RepeatRuleInput) => serialize(async () => {
    const result = await api.createRepeatRule(input);
    if (currentAccount()) {
      setRepeatRules(rules => [result.repeatRule, ...rules.filter(r => r.id !== result.repeatRule.id)]);
      if (result.spendings.length > 0) {
        setSpendings(records => {
          const ids = new Set(result.spendings.map(s => s.id));
          return [...records.filter(r => !ids.has(r.id)), ...result.spendings];
        });
      }
    }
    return result.repeatRule;
  }), [serialize, currentAccount]);

  const deleteRepeatRule = useCallback((id: string, deleteFuture = true) => serialize(async () => {
    await api.deleteRepeatRule(id, deleteFuture);
    if (currentAccount()) {
      setRepeatRules(rules => rules.filter(r => r.id !== id));
      if (deleteFuture) {
        const today = new Date().toISOString().slice(0, 10);
        setSpendings(records => records.filter(r => !(r.repeatRuleId === id && r.date >= today)));
      }
    }
  }), [serialize, currentAccount]);

  return (
    <FinanceContext.Provider value={{
      settings, spendings, incomeEntries, repeatRules, loading, hasLoaded, error,
      reload, fetchWeeksSpendings, updateSettings, createSpending, updateSpending, deleteSpending,
      createIncomeEntry, updateIncomeEntry, deleteIncomeEntry,
      createRepeatRule, deleteRepeatRule
    }}>
      {children}
    </FinanceContext.Provider>
  );
}


export function useFinance() {
  const context = useContext(FinanceContext);
  if (!context) throw new Error('useFinance must be used within a FinanceProvider');
  return context;
}
