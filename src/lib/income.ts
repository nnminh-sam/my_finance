import { format } from 'date-fns';
import type { IncomeEntry } from '../types';

export function incomeMonth(date: Date): string {
  return format(date, 'yyyy-MM');
}

/** Recurring income applies each month; extras apply only to their exact calendar month. */
export function getMonthIncome(baseIncome: number, month: string, incomeEntries: readonly IncomeEntry[]) {
  const entries = incomeEntries.filter(entry => entry.month === month);
  const additionalCents = entries.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0);
  const baseCents = Math.round(baseIncome * 100);
  return {
    baseIncome: baseCents / 100,
    additionalIncome: additionalCents / 100,
    totalIncome: (baseCents + additionalCents) / 100,
    entries,
  };
}
