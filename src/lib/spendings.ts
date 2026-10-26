import { format } from 'date-fns';
import type { Spending } from '../types';

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
  if (amount === 0) return '0';
  const sign = amount < 0 ? '-' : '';
  const absAmount = Math.abs(amount);
  if (absAmount < 1000) return `${sign}${absAmount.toLocaleString('vi-VN')} ₫`;
  const inK = absAmount / 1000;
  const formatted = inK.toLocaleString('vi-VN', {
    maximumFractionDigits: 1,
  });
  return `${sign}${formatted}k`;
};

/**
 * Sanitizes a user-typed money input string:
 * - Strips all non-numeric characters except a single 'k' / 'K' multiplier
 * - Expands a trailing 'k' / 'K' (e.g., "99k" -> "99000")
 * - Clamps to at most 13 digits (max 1,000,000,000,000)
 */
export function sanitizeMoneyInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const hasK = /[kK]$/.test(trimmed);
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (!digitsOnly) return '';
  const normalized = digitsOnly.replace(/^0+(?=\d)/, '');
  if (normalized === '0') return '0';
  const expanded = hasK ? `${normalized}000` : normalized;
  if (Number(expanded) > 1_000_000_000_000) {
    return expanded.slice(0, 12);
  }
  return expanded;
}

/**
 * Formats a clean numeric string with Vietnamese thousand separators (e.g. "99000" -> "99.000").
 */
export function formatMoneyInputDisplay(cleanDigits: string): string {
  if (!cleanDigits) return '';
  const digits = cleanDigits.replace(/\D/g, '');
  if (!digits) return '';
  const num = Number(digits);
  if (!Number.isFinite(num)) return digits;
  return num.toLocaleString('vi-VN');
}


