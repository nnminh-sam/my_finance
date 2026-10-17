import { format, isValid, parseISO } from 'date-fns';
import { pages } from './pages';
import type { FinancePage } from './pages';

export function pageHref(page: FinancePage, date?: Date): string {
  return date && page !== 'profile' ? `${pages[page].path}?date=${format(date, 'yyyy-MM-dd')}` : pages[page].path;
}

export function readPageDate(search: string, fallback = new Date()): Date {
  const value = new URLSearchParams(search).get('date');
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '0001-01-01') {
    const date = parseISO(value);
    if (isValid(date) && format(date, 'yyyy-MM-dd') === value) return date;
  }
  return new Date(fallback);
}

/** Only known finance documents may be login return destinations. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) {
    return pages.calendar.path;
  }
  try {
    const base = 'https://tracker.invalid';
    const url = new URL(value, base);
    const target = Object.values(pages).find(page => page.protected && page.path === url.pathname);
    if (url.origin === base && target) return `${target.path}${url.search}`;
  } catch {
    // Invalid or external destinations must never become authentication redirects.
  }
  return pages.calendar.path;
}

export function authHref(page: 'login' | 'signup', returnTo?: string | null): string {
  return returnTo ? `${pages[page].path}?${new URLSearchParams({ next: safeReturnPath(returnTo) })}` : pages[page].path;
}
