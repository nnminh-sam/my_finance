'use client';

import { createContext, useContext } from 'react';
import type { Spending } from '../types';

export interface FinanceShellContextValue {
  currentDate: Date;
  activeDate?: Date;
  onActiveDateChange?: (date: Date) => void;
  openDate: (date: Date) => void;
  openBackToCalendar: () => void;
  openExpense: (expense?: Spending) => void;
  openIncomeModal: (month: string) => void;
}

export const FinanceShellContext = createContext<FinanceShellContextValue | undefined>(undefined);

export function useFinanceShell(): FinanceShellContextValue {
  const context = useContext(FinanceShellContext);
  if (!context) throw new Error('useFinanceShell must be used within a FinanceShellProvider');
  return context;
}
