import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage, getAuthState } from '../auth';
import { createFinanceApi } from '../finance';
import type { FinanceSettings, SpendingInput } from '../finance';
import type { IncomeEntry, IncomeEntryInput, Spending } from '../types';

interface FinanceContextValue {
  settings: FinanceSettings;
  spendings: Spending[];
  incomeEntries: IncomeEntry[];
  loading: boolean;
  hasLoaded: boolean;
  error: string | null;
  reload: () => Promise<void>;
  updateSettings: (updates: Partial<FinanceSettings>) => Promise<void>;
  createSpending: (input: SpendingInput) => Promise<void>;
  updateSpending: (id: string, input: SpendingInput) => Promise<void>;
  deleteSpending: (id: string) => Promise<void>;
  createIncomeEntry: (input: IncomeEntryInput) => Promise<void>;
  updateIncomeEntry: (id: string, input: IncomeEntryInput) => Promise<void>;
  deleteIncomeEntry: (id: string) => Promise<void>;
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
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const loaded = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const reloadFlight = useRef<Promise<void> | null>(null);

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

  const reload = useCallback((): Promise<void> => {
    if (reloadFlight.current) return reloadFlight.current;
    reloadFlight.current = serialize(async () => {
      if (!loaded.current) setLoading(true);
      try {
        const [nextSettings, nextSpendings, nextIncomeEntries] = await Promise.all([api.getSettings(), api.getSpendings(), api.getIncomeEntries()]);
        if (!currentAccount()) return;
        setSettings(nextSettings);
        setSpendings(nextSpendings);
        setIncomeEntries(nextIncomeEntries);
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

  return (
    <FinanceContext.Provider value={{ settings, spendings, incomeEntries, loading, hasLoaded, error, reload, updateSettings, createSpending, updateSpending, deleteSpending, createIncomeEntry, updateIncomeEntry, deleteIncomeEntry }}>
      {children}
    </FinanceContext.Provider>
  );
}

export function useFinance() {
  const context = useContext(FinanceContext);
  if (!context) throw new Error('useFinance must be used within a FinanceProvider');
  return context;
}
