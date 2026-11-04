import { validateExpenseDraft } from './expenseDraft';
import type { ExpenseDraft } from './expenseDraft';
import { validateIncomeDraft } from './incomeDraft';
import type { SpendingInput } from '../services/finance';
import type { CategoryData, IncomeFrequency, IncomeInput, PlanInput, RepeatEndType, RepeatFrequency, Spending } from '../types';

/**
 * Quick entry (direction A): one keypad-first input for spending and income, shared by the
 * phone dock and the web dialog. Pure helpers live here so both UIs and the tests agree.
 */

export type EntryMode = 'spending' | 'income';

export interface RepeatDraft {
  on: boolean;
  frequency: RepeatFrequency;
  interval: number;
  /** JavaScript weekday numbers (0 = Sunday), as the server expects. */
  daysOfWeek: number[];
  endType: RepeatEndType;
  count: number;
  endDate: string;
}

export interface IncomeEntry {
  source: string;
  name: string;
  frequency: IncomeFrequency;
  startDate: string;
  endDate: string; // '' = no end
}

export interface QuickEntry {
  mode: EntryMode;
  /** Whole đồng as typed on the keypad, without separators ('' = nothing typed). */
  amount: string;
  category: string;
  description: string;
  date: string;
  time: string;
  repeat: RepeatDraft;
  income: IncomeEntry;
  /** The Plan tab: always save as a plan (needs a future date/time or a repeat). */
  plan: boolean;
  /** Commitment vs estimate; null = decide from the category. */
  sure: boolean | null;
}

export type PreparedEntry =
  | { kind: 'spending'; input: SpendingInput }
  | { kind: 'plan'; input: PlanInput }
  | { kind: 'income'; input: IncomeInput };

export const MAX_AMOUNT_DIGITS = 12;
export const INCOME_SOURCES = ['Salary', 'Freelance', 'Bonus', 'Allowance', 'Gift', 'Investment', 'Other'] as const;
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (value: number) => String(value).padStart(2, '0');

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function nowTime(now = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function defaultRepeat(date: string): RepeatDraft {
  return { on: false, frequency: 'daily', interval: 1, daysOfWeek: [weekdayOf(date)], endType: 'unlimited', count: 10, endDate: '' };
}

export function createQuickEntry(categories: readonly Pick<CategoryData, 'id'>[], date: string, now = new Date()): QuickEntry {
  return {
    mode: 'spending',
    amount: '',
    category: categories[0]?.id ?? '',
    description: '',
    date,
    time: nowTime(now),
    repeat: defaultRepeat(date),
    income: { source: 'Salary', name: '', frequency: 'monthly', startDate: date, endDate: '' },
    plan: false,
    sure: null,
  };
}

export function entryFromSpending(spending: Spending, categories: readonly Pick<CategoryData, 'id'>[]): QuickEntry {
  const entry = createQuickEntry(categories, spending.date);
  return {
    ...entry,
    amount: String(Math.round(spending.amount)),
    category: spending.category,
    description: spending.description,
    time: spending.time,
  };
}

/** The entry that follows a queued one: same mode, category, day and time; amount and text cleared. */
export function nextQuickEntry(entry: QuickEntry): QuickEntry {
  return {
    ...entry,
    amount: '',
    description: '',
    repeat: defaultRepeat(entry.date),
    income: { ...entry.income, name: '' },
    sure: null,
  };
}

/** Applies one keypad key ('0'–'9', '000', 'del') to the typed digits. */
export function pressKey(digits: string, key: string): string {
  if (key === 'del') return digits.slice(0, -1);
  if (!/^\d+$/.test(key)) return digits;
  const next = (digits + key).replace(/^0+/, '');
  return next.length > MAX_AMOUNT_DIGITS ? digits : next;
}

export function entryAmount(entry: Pick<QuickEntry, 'amount'>): number {
  return Number(entry.amount || '0');
}

/** Local "now" as a comparable YYYY-MM-DDTHH:mm stamp. */
export function nowStamp(now = new Date()): string {
  return `${isoDate(now)}T${nowTime(now)}`;
}

const entryStamp = (entry: Pick<QuickEntry, 'date' | 'time'>) => `${entry.date}T${entry.time}`;

/** Bills, rent and subscriptions default to commitments; everything else to estimates. */
export function defaultSure(categoryName: string): boolean {
  return /bill|rent|home|subscri|internet|phone|electric|insurance|tuition|loan|debt/i.test(categoryName);
}

/** A spending entry becomes a plan when the Plan tab is on, it repeats, or its date and time are still ahead. */
export function isPlanEntry(entry: QuickEntry, now = new Date()): boolean {
  return entry.mode === 'spending' && (entry.plan || entry.repeat.on || entryStamp(entry) > nowStamp(now));
}

/** Validates an entry with the same rules as the full form. A blank description becomes the category name. */
export function prepareEntry(entry: QuickEntry, categories: readonly CategoryData[], now = new Date(), asSpending = false): PreparedEntry {
  if (entry.mode === 'income') {
    return {
      kind: 'income',
      input: validateIncomeDraft({ ...entry.income, amount: entry.amount }),
    };
  }
  const category = categories.find(item => item.id === entry.category);
  if (!category) throw new Error('Choose an available category from settings.');
  const categoryName = category.name;
  const draft: ExpenseDraft = {
    amount: entry.amount,
    description: entry.description.trim() || categoryName,
    category: entry.category,
    date: entry.date,
    time: entry.time,
    isRepeat: entry.repeat.on,
    repeatFrequency: entry.repeat.frequency,
    repeatInterval: entry.repeat.interval,
    repeatDaysOfWeek: entry.repeat.frequency === 'weekly' ? [...entry.repeat.daysOfWeek].sort((a, b) => a - b) : undefined,
    repeatEndType: entry.repeat.endType,
    repeatCount: entry.repeat.count,
    repeatEndDate: entry.repeat.endDate,
  };
  const input = validateExpenseDraft({ ...draft, isRepeat: false }, categories);
  // Editing an existing spending never turns it into a plan, even when it is dated ahead.
  if (asSpending || !isPlanEntry(entry, now)) return { kind: 'spending', input };
  if (!entry.repeat.on && entryStamp(entry) <= nowStamp(now)) {
    throw new Error('A plan needs a future date or time, or Repeat turned on.');
  }
  const r = entry.repeat;
  if (r.on && r.frequency === 'weekly' && r.daysOfWeek.length === 0) throw new Error('Pick at least one day for a weekly repeat.');
  if (r.on && (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 365)) throw new Error('Repeat every 1 to 365 days.');
  const endDate = r.on && r.endType === 'until_date' && r.endDate ? r.endDate : null;
  if (endDate && endDate < entry.date) throw new Error('The end date cannot be before the start date.');
  return {
    kind: 'plan',
    input: {
      amount: input.amount, description: input.description, category: input.category, time: input.time, startDate: input.date,
      frequency: r.on ? r.frequency : 'once', interval: r.on && r.frequency === 'daily' ? r.interval : 1,
      daysOfWeek: r.on && r.frequency === 'weekly' ? [...r.daysOfWeek].sort((a, b) => a - b) : [],
      endDate, sure: entry.sure ?? defaultSure(categoryName),
    },
  };
}

export function prepareEntries(entries: readonly QuickEntry[], categories: readonly CategoryData[], now = new Date()): PreparedEntry[] {
  return entries.map((entry, index) => {
    try {
      return prepareEntry(entry, categories, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(entries.length > 1 ? `Entry ${index + 1}: ${message}` : message);
    }
  });
}

export interface EntrySavers {
  spending: (input: SpendingInput) => Promise<unknown>;
  plan: (input: PlanInput) => Promise<unknown>;
  income: (input: IncomeInput) => Promise<unknown>;
}

/** Saves in order and stops at the first failure, returning what is still pending so a retry never duplicates. */
export async function saveEntries<T extends { prepared: PreparedEntry }>(
  items: readonly T[],
  savers: EntrySavers,
): Promise<{ saved: T[]; remaining: T[]; error?: unknown }> {
  const saved: T[] = [];
  for (const [index, item] of items.entries()) {
    try {
      const { prepared } = item;
      if (prepared.kind === 'income') await savers.income(prepared.input);
      else if (prepared.kind === 'plan') await savers.plan(prepared.input);
      else await savers.spending(prepared.input);
    } catch (error) {
      return { saved, remaining: items.slice(index), error };
    }
    saved.push(item);
  }
  return { saved, remaining: [] };
}

export function dayLabel(date: string, today = new Date()): string {
  const t = isoDate(today);
  const shift = (days: number) => { const d = new Date(today); d.setDate(d.getDate() + days); return isoDate(d); };
  if (date === t) return 'Today';
  if (date === shift(-1)) return 'Yesterday';
  if (date === shift(1)) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return `${WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS[m - 1]}`;
}

export function repeatSummary(repeat: RepeatDraft, today = new Date()): string {
  if (!repeat.on) return 'Once';
  let text = repeat.frequency === 'daily' ? (repeat.interval === 1 ? 'Every day' : `Every ${repeat.interval} days`)
    : repeat.frequency === 'weekdays' ? 'Weekdays'
    : repeat.frequency === 'weekly'
      ? `Weekly · ${WEEKDAY_ORDER.filter(day => repeat.daysOfWeek.includes(day)).map(day => WEEKDAY_SHORT[day]).join(', ') || 'pick days'}`
      : 'Monthly';
  if (repeat.endType === 'until_date' && repeat.endDate) text += ` · until ${dayLabel(repeat.endDate, today)}`;
  return text;
}

export const INCOME_FREQUENCY_SHORT: Record<IncomeFrequency, string> = {
  once: 'One time', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly',
};

export function incomeSummary(income: IncomeEntry, today = new Date()): string {
  if (income.frequency === 'once') return `On ${dayLabel(income.startDate, today)}`;
  return `${INCOME_FREQUENCY_SHORT[income.frequency]} from ${dayLabel(income.startDate, today)}${income.endDate ? ` to ${dayLabel(income.endDate, today)}` : ''}`;
}

export function formatVnd(amount: number): string {
  return `${amount.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ₫`;
}
