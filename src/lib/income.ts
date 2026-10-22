import { format } from 'date-fns';
import type { Income, IncomeFrequency } from '../types';

export const INCOME_FREQUENCY_LABELS: Record<IncomeFrequency, string> = {
  once: 'One time',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

export const INCOME_SOURCE_SUGGESTIONS = ['Salary', 'Freelance', 'Bonus', 'Allowance', 'Gift', 'Investment', 'Other'] as const;

export function incomeMonth(date: Date): string {
  return format(date, 'yyyy-MM');
}

// Date strings are calendar dates without a timezone, so all arithmetic runs in UTC.
// setUTCFullYear sets year, month, and day together (Date.UTC maps years 0–99 to 1900–1999).
function utcDate(year: number, monthIndex: number, day: number): number {
  const value = new Date(0);
  value.setUTCFullYear(year, monthIndex, day);
  return value.getTime();
}

function toUtc(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return utcDate(year, month - 1, day);
}

const DAY_MS = 86_400_000;

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(utcDate(year, monthIndex + 1, 0)).getUTCDate();
}

export function monthRange(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const last = String(daysInMonth(year, monthNumber - 1)).padStart(2, '0');
  return { start: `${month}-01`, end: `${month}-${last}` };
}

/**
 * Number of times an income is paid within [rangeStart, rangeEnd] (inclusive YYYY-MM-DD).
 * Monthly and yearly income falls on the start date's day, clamped to shorter months
 * (e.g. the 31st pays on Feb 28/29), and February 29 yearly income pays on Feb 28 in common years.
 */
export function countIncomeOccurrences(income: Pick<Income, 'frequency' | 'startDate' | 'endDate'>, rangeStart: string, rangeEnd: string): number {
  const start = toUtc(income.startDate);
  const windowStart = Math.max(start, toUtc(rangeStart));
  const windowEnd = Math.min(income.endDate ? toUtc(income.endDate) : Infinity, toUtc(rangeEnd));
  if (windowEnd < windowStart) return 0;

  switch (income.frequency) {
    case 'once':
      return start >= toUtc(rangeStart) ? 1 : 0;
    case 'daily':
      return Math.round((windowEnd - windowStart) / DAY_MS) + 1;
    case 'weekly': {
      const first = Math.ceil((windowStart - start) / (7 * DAY_MS));
      const last = Math.floor((windowEnd - start) / (7 * DAY_MS));
      return Math.max(0, last - first + 1);
    }
    case 'monthly':
    case 'yearly': {
      const anchor = new Date(start);
      const anchorDay = anchor.getUTCDate();
      const from = new Date(windowStart);
      const to = new Date(windowEnd);
      let count = 0;
      for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year++) {
        const firstMonth = year === from.getUTCFullYear() ? from.getUTCMonth() : 0;
        const lastMonth = year === to.getUTCFullYear() ? to.getUTCMonth() : 11;
        for (let monthIndex = firstMonth; monthIndex <= lastMonth; monthIndex++) {
          if (income.frequency === 'yearly' && monthIndex !== anchor.getUTCMonth()) continue;
          const payday = utcDate(year, monthIndex, Math.min(anchorDay, daysInMonth(year, monthIndex)));
          if (payday >= windowStart && payday <= windowEnd) count++;
        }
      }
      return count;
    }
  }
}

export interface MonthIncomeItem {
  income: Income;
  occurrences: number;
  total: number;
}

/** Total income received in a calendar month (YYYY-MM), split into recurring and one-time income. */
export function getMonthIncome(month: string, incomes: readonly Income[]) {
  const { start, end } = monthRange(month);
  const items: MonthIncomeItem[] = [];
  let recurringCents = 0;
  let oneTimeCents = 0;
  for (const income of incomes) {
    const occurrences = countIncomeOccurrences(income, start, end);
    if (occurrences === 0) continue;
    const cents = Math.round(income.amount * 100) * occurrences;
    if (income.frequency === 'once') oneTimeCents += cents;
    else recurringCents += cents;
    items.push({ income, occurrences, total: cents / 100 });
  }
  return {
    recurringIncome: recurringCents / 100,
    oneTimeIncome: oneTimeCents / 100,
    totalIncome: (recurringCents + oneTimeCents) / 100,
    items,
  };
}

export function describeIncomeSchedule(income: Pick<Income, 'frequency' | 'startDate' | 'endDate'>): string {
  if (income.frequency === 'once') return `One time on ${income.startDate}`;
  const label = INCOME_FREQUENCY_LABELS[income.frequency];
  return income.endDate ? `${label} · ${income.startDate} to ${income.endDate}` : `${label} · from ${income.startDate}`;
}
