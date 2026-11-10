import { format } from 'date-fns';
import type { Income, IncomeScheduleFrequency } from '../types';

export const INCOME_FREQUENCY_LABELS: Record<IncomeScheduleFrequency, string> = {
  once: 'One time',
  daily: 'Daily',
  weekly: 'Weekly',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

export const INCOME_SOURCE_SUGGESTIONS = ['Salary', 'Freelance', 'Bonus', 'Allowance', 'Gift', 'Investment', 'Other'] as const;

export function incomeMonth(date: Date): string {
  return format(date, 'yyyy-MM');
}

// Date strings are calendar dates without a timezone, so all arithmetic runs in UTC.
// setUTCFullYear sets year, month, and day together (Date.UTC maps years 0–99 to 1900–1999).
export function utcDate(year: number, monthIndex: number, day: number): number {
  const value = new Date(0);
  value.setUTCFullYear(year, monthIndex, day);
  return value.getTime();
}

export function toUtc(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return utcDate(year, month - 1, day);
}

export const DAY_MS = 86_400_000;

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(utcDate(year, monthIndex + 1, 0)).getUTCDate();
}

export function monthRange(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const last = String(daysInMonth(year, monthNumber - 1)).padStart(2, '0');
  return { start: `${month}-01`, end: `${month}-${last}` };
}

export type IncomeSchedule = Pick<Income, 'frequency' | 'startDate' | 'endDate' | 'interval' | 'semimonthlyDays' | 'weekendShift'>;

export function incomeInterval(income: Pick<Income, 'interval'>): 1 | 2 | 4 {
  return income.interval ?? 1;
}

export function incomeWeekendShift(income: Pick<Income, 'weekendShift'>): boolean {
  return income.weekendShift === true;
}

/** True when the income uses a pay-schedule option; every other income keeps the original counting path. */
function usesScheduleOptions(income: IncomeSchedule): boolean {
  return income.frequency === 'semimonthly' || incomeInterval(income) !== 1 || incomeWeekendShift(income);
}

function dateString(time: number): string {
  const date = new Date(time);
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Saturday is paid on Friday (-1 day) and Sunday on Friday (-2 days); other days do not move. */
function weekendShifted(time: number): number {
  const weekday = new Date(time).getUTCDay();
  if (weekday === 6) return time - DAY_MS;
  if (weekday === 0) return time - 2 * DAY_MS;
  return time;
}

/** Nominal payday times (UTC ms) inside [from, to]. The caller clips `from` and `to` to the start and end dates unless unbounded. */
function nominalPaydays(income: IncomeSchedule, from: number, to: number): number[] {
  if (to < from) return [];
  const start = toUtc(income.startDate);
  const result: number[] = [];
  switch (income.frequency) {
    case 'once':
      if (start >= from && start <= to) result.push(start);
      break;
    case 'daily':
      for (let time = from; time <= to; time += DAY_MS) result.push(time);
      break;
    case 'weekly': {
      const stride = 7 * incomeInterval(income) * DAY_MS;
      const first = Math.ceil((from - start) / stride);
      const last = Math.floor((to - start) / stride);
      for (let index = first; index <= last; index++) result.push(start + index * stride);
      break;
    }
    case 'semimonthly': {
      const days = income.semimonthlyDays;
      if (!days) break;
      const a = new Date(from);
      const b = new Date(to);
      for (let year = a.getUTCFullYear(); year <= b.getUTCFullYear(); year++) {
        const firstMonth = year === a.getUTCFullYear() ? a.getUTCMonth() : 0;
        const lastMonth = year === b.getUTCFullYear() ? b.getUTCMonth() : 11;
        for (let monthIndex = firstMonth; monthIndex <= lastMonth; monthIndex++) {
          const length = daysInMonth(year, monthIndex);
          for (const day of days) {
            const payday = utcDate(year, monthIndex, Math.min(day, length));
            if (payday >= from && payday <= to) result.push(payday);
          }
        }
      }
      break;
    }
    case 'monthly':
    case 'yearly': {
      const anchor = new Date(start);
      const anchorDay = anchor.getUTCDate();
      const a = new Date(from);
      const b = new Date(to);
      for (let year = a.getUTCFullYear(); year <= b.getUTCFullYear(); year++) {
        const firstMonth = year === a.getUTCFullYear() ? a.getUTCMonth() : 0;
        const lastMonth = year === b.getUTCFullYear() ? b.getUTCMonth() : 11;
        for (let monthIndex = firstMonth; monthIndex <= lastMonth; monthIndex++) {
          if (income.frequency === 'yearly' && monthIndex !== anchor.getUTCMonth()) continue;
          const payday = utcDate(year, monthIndex, Math.min(anchorDay, daysInMonth(year, monthIndex)));
          if (payday >= from && payday <= to) result.push(payday);
        }
      }
      break;
    }
  }
  return result;
}

/**
 * Paydays whose PAID date falls in [rangeStart, rangeEnd] (inclusive YYYY-MM-DD).
 * The start and end dates apply to the nominal payday. With the weekend shift on, a Saturday or Sunday
 * payday is paid on the Friday before, so a payday can be paid before the start date or in the previous
 * month. `unbounded` ignores the start and end dates (used only to extrapolate paycheck period
 * boundaries, never for real totals).
 */
export function incomePaydays(
  income: IncomeSchedule,
  rangeStart: string,
  rangeEnd: string,
  options: { unbounded?: boolean } = {},
): { nominal: string; paid: string }[] {
  const shift = incomeWeekendShift(income);
  const from = toUtc(rangeStart);
  const to = toUtc(rangeEnd);
  // A shift only moves a payday earlier, by at most two days.
  const nominalTo = shift ? to + 2 * DAY_MS : to;
  const bounded = !options.unbounded;
  const windowFrom = bounded ? Math.max(toUtc(income.startDate), from) : from;
  const windowTo = bounded && income.endDate ? Math.min(toUtc(income.endDate), nominalTo) : nominalTo;
  const result: { nominal: string; paid: string }[] = [];
  for (const nominal of nominalPaydays(income, windowFrom, windowTo)) {
    const paid = shift ? weekendShifted(nominal) : nominal;
    if (paid >= from && paid <= to) result.push({ nominal: dateString(nominal), paid: dateString(paid) });
  }
  return result.sort((a, b) => a.paid.localeCompare(b.paid) || a.nominal.localeCompare(b.nominal));
}

/** Local time of day an income payment is recorded at: the start of its paid day. */
export const INCOME_RECORD_TIME = '00:00';

/**
 * Paydays that are due to become income records: paid at or before `now` and strictly after the
 * watermark `after` (null = none recorded yet, so every payday from the start date). Both are local
 * `YYYY-MM-DDTHH:mm` stamps. A payday counts from INCOME_RECORD_TIME on its paid (weekend-shifted) day.
 */
export function dueIncomePaydays(income: IncomeSchedule, after: string | null, now: string): { nominal: string; paid: string }[] {
  const rangeStart = after ? after.slice(0, 10) : '0001-01-01';
  const rangeEnd = now.slice(0, 10);
  if (rangeEnd < rangeStart) return [];
  return incomePaydays(income, rangeStart, rangeEnd).filter(({ paid }) => {
    const stamp = `${paid}T${INCOME_RECORD_TIME}`;
    return (after === null || stamp > after) && stamp <= now;
  });
}

/**
 * Number of times an income is paid within [rangeStart, rangeEnd] (inclusive YYYY-MM-DD).
 * Monthly and yearly income falls on the start date's day, clamped to shorter months
 * (e.g. the 31st pays on Feb 28/29), and February 29 yearly income pays on Feb 28 in common years.
 * Incomes that use a pay-schedule option (every 2 or 4 weeks, twice a month, weekend shift) are
 * counted by `incomePaydays`.
 */
export function countIncomeOccurrences(income: IncomeSchedule, rangeStart: string, rangeEnd: string): number {
  if (usesScheduleOptions(income)) return incomePaydays(income, rangeStart, rangeEnd).length;
  const start = toUtc(income.startDate);
  const windowStart = Math.max(start, toUtc(rangeStart));
  const windowEnd = Math.min(income.endDate ? toUtc(income.endDate) : Infinity, toUtc(rangeEnd));
  if (windowEnd < windowStart) return 0;

  switch (income.frequency) {
    case 'once':
      return start >= toUtc(rangeStart) ? 1 : 0;
    case 'daily':
      return Math.round((windowEnd - windowStart) / DAY_MS) + 1;
    case 'semimonthly':
      return incomePaydays(income, rangeStart, rangeEnd).length;
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

/** A real income payment from the ledger (kind income): written from a schedule once its payday passed. */
export interface IncomeRecord {
  amount: number;
  date: string; // YYYY-MM-DD, the paid day
  incomeId?: string | null; // null once its schedule is deleted
}

/**
 * Income within [start, end] (inclusive YYYY-MM-DD), split into recurring and one-time income, and into
 * received (paid up to `today`) and expected (paid after it).
 *
 * With `received` (the ledger's income rows), the past comes from those rows: an edited amount, a moved
 * date or a deleted payment counts as it is stored, and editing or deleting a schedule never changes it.
 * Only paydays after `today` are projected from the schedules. Without it, every payday is projected from
 * the schedules (the server's MCP summaries still use this path).
 */
export function getRangeIncome(
  start: string,
  end: string,
  incomes: readonly Income[],
  received?: readonly IncomeRecord[],
  today: string = format(new Date(), 'yyyy-MM-dd'),
) {
  const items: MonthIncomeItem[] = [];
  let recurringCents = 0;
  let oneTimeCents = 0;
  let receivedCents = 0;
  const tomorrow = dateString(toUtc(today) + DAY_MS);
  const futureStart = start > tomorrow ? start : tomorrow;
  const byId = new Map(incomes.map(income => [income.id, income]));
  const recordsOf = new Map<string, { count: number; cents: number }>();

  if (received) {
    for (const record of received) {
      if (record.date < start || record.date > end) continue;
      const cents = Math.round(record.amount * 100);
      receivedCents += cents;
      const schedule = record.incomeId ? byId.get(record.incomeId) : undefined;
      // A payment whose schedule was deleted has no frequency left; it counts as one-time.
      if (schedule && schedule.frequency !== 'once') recurringCents += cents;
      else oneTimeCents += cents;
      if (schedule) {
        const entry = recordsOf.get(schedule.id) ?? { count: 0, cents: 0 };
        recordsOf.set(schedule.id, { count: entry.count + 1, cents: entry.cents + cents });
      }
    }
  }

  for (const income of incomes) {
    const perPayday = Math.round(income.amount * 100);
    const past = received
      ? recordsOf.get(income.id) ?? { count: 0, cents: 0 }
      : (() => {
        const count = today < start ? 0 : countIncomeOccurrences(income, start, end < today ? end : today);
        return { count, cents: count * perPayday };
      })();
    if (!received) receivedCents += past.cents;
    const futureCount = futureStart > end ? 0 : countIncomeOccurrences(income, futureStart, end);
    const futureCents = futureCount * perPayday;
    if (!received) {
      if (income.frequency === 'once') oneTimeCents += past.cents;
      else recurringCents += past.cents;
    }
    if (income.frequency === 'once') oneTimeCents += futureCents;
    else recurringCents += futureCents;
    const occurrences = past.count + futureCount;
    if (occurrences === 0) continue;
    items.push({ income, occurrences, total: (past.cents + futureCents) / 100 });
  }
  return {
    recurringIncome: recurringCents / 100,
    oneTimeIncome: oneTimeCents / 100,
    totalIncome: (recurringCents + oneTimeCents) / 100,
    receivedIncome: receivedCents / 100,
    expectedIncome: (recurringCents + oneTimeCents - receivedCents) / 100,
    items,
  };
}

/** Total income received in a calendar month (YYYY-MM), split into recurring and one-time income. */
export function getMonthIncome(month: string, incomes: readonly Income[], received?: readonly IncomeRecord[], today?: string) {
  const { start, end } = monthRange(month);
  return getRangeIncome(start, end, incomes, received, today);
}

export function describeIncomeSchedule(income: IncomeSchedule): string {
  if (income.frequency === 'once') return `One time on ${income.startDate}`;
  let label = INCOME_FREQUENCY_LABELS[income.frequency];
  const interval = incomeInterval(income);
  if (income.frequency === 'weekly' && interval !== 1) label = `Every ${interval} weeks`;
  if (income.frequency === 'semimonthly' && income.semimonthlyDays) label = `Twice a month (${income.semimonthlyDays.join(' and ')})`;
  if (incomeWeekendShift(income)) label += ', Friday if weekend';
  return income.endDate ? `${label} · ${income.startDate} to ${income.endDate}` : `${label} · from ${income.startDate}`;
}

/** A payday that has not come yet, projected from an income schedule. */
export interface ExpectedPayday {
  incomeId: string;
  source: string;
  name: string;
  amount: number;
  date: string; // YYYY-MM-DD, the day it will be paid (after any weekend shift)
}

/** Paydays within [from, to] (inclusive YYYY-MM-DD) that are paid after `today`, sorted by date. Earlier ones are ledger rows. */
export function expectedPaydays(
  incomes: readonly Income[],
  from: string,
  to: string,
  today: string = format(new Date(), 'yyyy-MM-dd'),
): ExpectedPayday[] {
  const tomorrow = dateString(toUtc(today) + DAY_MS);
  const start = from > tomorrow ? from : tomorrow;
  if (start > to) return [];
  return incomes
    .flatMap(income => incomePaydays(income, start, to).map(({ paid }) => ({
      incomeId: income.id, source: income.source, name: income.name, amount: income.amount, date: paid,
    })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
}
