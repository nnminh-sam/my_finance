'use client';

import { createContext, useContext } from 'react';
import type { Spending } from '../types';
import type { ExpenseDraft } from '../lib/expenseDraft';

export type ExpenseDefaults = Partial<Pick<ExpenseDraft, 'amount' | 'category' | 'date' | 'description'>>;

export interface FinanceShellContextValue {
  currentDate: Date;
  activeDate?: Date;
  onActiveDateChange?: (date: Date) => void;
  openDate: (date: Date) => void;
  openBackToCalendar: () => void;
  openExpense: (expense?: Spending, defaults?: ExpenseDefaults) => void;
  openIncomeModal: (month: string) => void;
  /** Opens the "Plan this period" screen for the budget period that contains a YYYY-MM-DD date (default: today). */
  openPlanPeriod: (date?: string) => void;
  /** Mobile Week: whether the quick-add keypad is docked. Kept in the shell so it survives tab switches. */
  keypadOpen: boolean;
  setKeypadOpen: (open: boolean) => void;
  /** Increments each time the + tab asks the keypad to draw attention to itself. */
  keypadPulse: number;
  /** Desktop Calendar: one page per calendar month or per pay cycle. Chosen in the top bar. */
  calendarBasis: CalendarBasis;
  setCalendarBasis: (basis: CalendarBasis) => void;
}

export type CalendarBasis = 'month' | 'cycle';

export const FinanceShellContext = createContext<FinanceShellContextValue | undefined>(undefined);

export function useFinanceShell(): FinanceShellContextValue {
  const context = useContext(FinanceShellContext);
  if (!context) throw new Error('useFinanceShell must be used within a FinanceShellProvider');
  return context;
}
