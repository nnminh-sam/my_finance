import { format } from 'date-fns';
import type { Spending } from './types';

export const getSpendingsForDate = (date: Date, spendings: Spending[]): Spending[] => {
  const dateString = format(date, 'yyyy-MM-dd');
  return spendings
    .filter((spending) => spending.date === dateString)
    .sort((a, b) => a.time.localeCompare(b.time));
};

export const getTotalForDate = (date: Date, spendings: Spending[]): number =>
  getSpendingsForDate(date, spendings).reduce((total, spending) => total + spending.amount, 0);

export const getTopSpendingsForDate = (date: Date, count: number, spendings: Spending[]): Spending[] =>
  getSpendingsForDate(date, spendings)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, Math.max(0, count));

export const formatCompactSpending = (amount: number): string => {
  if (amount <= 0) return '0';
  if (amount < 1000) return `${amount.toLocaleString('vi-VN')} ₫`;
  const inK = amount / 1000;
  const formatted = inK.toLocaleString('vi-VN', {
    maximumFractionDigits: 1,
  });
  return `${formatted}k`;
};

