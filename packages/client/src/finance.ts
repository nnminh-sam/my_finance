import { authenticatedFetch } from './auth';
import type { IncomeEntry, IncomeEntryInput, Spending, UserSettings } from './types';

export type FinanceSettings = Pick<UserSettings, 'income' | 'avatar' | 'categories'>;
export type SpendingInput = Omit<Spending, 'id'>;
type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export function createFinanceApi(fetcher: Fetcher = authenticatedFetch) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetcher(`/api/v1/finance${path}`, init);
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: unknown } | null;
      throw new Error(typeof data?.error === 'string' ? data.error : 'Unable to load or save finance data. Please try again.');
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  function json(method: string, body: unknown): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }

  return {
    async getSettings(): Promise<FinanceSettings> {
      return (await request<{ settings: FinanceSettings }>('/settings')).settings;
    },
    async updateSettings(updates: Partial<FinanceSettings>): Promise<FinanceSettings> {
      return (await request<{ settings: FinanceSettings }>('/settings', json('PUT', updates))).settings;
    },
    async getSpendings(): Promise<Spending[]> {
      const records = new Map<string, Spending>();
      const visited = new Set<string>();
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: '500' });
        if (cursor) query.set('cursor', cursor);
        const page = await request<{ spendings: Spending[]; nextCursor: string | null }>(`/spendings?${query}`);
        for (const spending of page.spendings) records.set(spending.id, spending);
        cursor = page.nextCursor;
        if (cursor) {
          if (visited.has(cursor)) throw new Error('The server returned a repeated finance page. Please reload.');
          visited.add(cursor);
        }
      } while (cursor);
      return [...records.values()];
    },
    async getIncomeEntries(): Promise<IncomeEntry[]> {
      const records = new Map<string, IncomeEntry>();
      const visited = new Set<string>();
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: '500' });
        if (cursor) query.set('cursor', cursor);
        const page = await request<{ incomeEntries: IncomeEntry[]; nextCursor: string | null }>(`/income-entries?${query}`);
        for (const entry of page.incomeEntries) records.set(entry.id, entry);
        cursor = page.nextCursor;
        if (cursor) {
          if (visited.has(cursor)) throw new Error('The server returned a repeated income page. Please reload.');
          visited.add(cursor);
        }
      } while (cursor);
      return [...records.values()];
    },
    async createIncomeEntry(input: IncomeEntryInput): Promise<IncomeEntry> {
      return (await request<{ incomeEntry: IncomeEntry }>('/income-entries', json('POST', input))).incomeEntry;
    },
    async updateIncomeEntry(id: string, input: IncomeEntryInput): Promise<IncomeEntry> {
      return (await request<{ incomeEntry: IncomeEntry }>(`/income-entries/${encodeURIComponent(id)}`, json('PUT', input))).incomeEntry;
    },
    async deleteIncomeEntry(id: string): Promise<void> {
      await request<void>(`/income-entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async createSpending(input: SpendingInput): Promise<Spending> {
      return (await request<{ spending: Spending }>('/spendings', json('POST', input))).spending;
    },
    async updateSpending(id: string, input: SpendingInput): Promise<Spending> {
      return (await request<{ spending: Spending }>(`/spendings/${encodeURIComponent(id)}`, json('PUT', input))).spending;
    },
    async deleteSpending(id: string): Promise<void> {
      await request<void>(`/spendings/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
