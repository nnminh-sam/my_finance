// Budget periods: the span of days a plan or summary is grouped by.
//
// Pure date math shared by the server and the browser. `calendar` is the calendar month,
// `monthly_from_day` starts a period on a fixed day of each month, and `paycheck` starts a period on
// each (weekend-shifted) payday of one chosen income, extrapolated before its start date and after its
// end date so every day belongs to a period.

import { daysInMonth, incomePaydays, type IncomeSchedule } from './income';
import { addDays, MAX_RANGE_DAYS } from './plans';

export const BUDGET_PERIOD_MODES = ['calendar', 'monthly_from_day', 'paycheck'] as const;
export type BudgetPeriodMode = typeof BUDGET_PERIOD_MODES[number];

/** Incomes with a regular payday that can start a paycheck period. */
export const PAYCHECK_FREQUENCIES = ['weekly', 'semimonthly', 'monthly'] as const;

export interface BudgetPeriodSetting {
  mode: BudgetPeriodMode;
  startDay: number; // 1-28, monthly_from_day only
  paycheckIncomeId: string | null; // paycheck only
}

export const DEFAULT_BUDGET_PERIOD: BudgetPeriodSetting = { mode: 'calendar', startDay: 1, paycheckIncomeId: null };

export interface BudgetPeriod {
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
  nextStart: string; // first day of the following period
  mode: BudgetPeriodMode; // the mode actually used (calendar when paycheck mode fell back)
}

export type PeriodIncome = IncomeSchedule & { id: string };

// The paycheck search window around a date: the longest stride is 31 days plus a 2-day weekend shift.
const SEARCH_DAYS = 45;

const pad = (value: number) => String(value).padStart(2, '0');

function calendarPeriod(date: string): BudgetPeriod {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const end = `${date.slice(0, 7)}-${pad(daysInMonth(year, month - 1))}`;
  return { start: `${date.slice(0, 7)}-01`, end, nextStart: addDays(end, 1), mode: 'calendar' };
}

function monthlyFromDayPeriod(startDay: number, date: string): BudgetPeriod {
  let year = Number(date.slice(0, 4));
  let month = Number(date.slice(5, 7));
  if (Number(date.slice(8, 10)) < startDay) {
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth === 13) { nextMonth = 1; nextYear += 1; }
  const start = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(startDay)}`;
  const nextStart = `${String(nextYear).padStart(4, '0')}-${pad(nextMonth)}-${pad(startDay)}`;
  return { start, end: addDays(nextStart, -1), nextStart, mode: 'monthly_from_day' };
}

function paycheckPeriod(income: PeriodIncome, date: string): BudgetPeriod | null {
  const paydays = incomePaydays(income, addDays(date, -SEARCH_DAYS), addDays(date, SEARCH_DAYS), { unbounded: true });
  const boundaries = [...new Set(paydays.map(payday => payday.paid))].sort();
  const before = boundaries.filter(boundary => boundary <= date);
  const after = boundaries.find(boundary => boundary > date);
  if (before.length === 0 || after === undefined) return null;
  const start = before[before.length - 1];
  return { start, end: addDays(after, -1), nextStart: after, mode: 'paycheck' };
}

/** The period containing `date` (YYYY-MM-DD). Never throws for a valid date. */
export function periodOf(setting: BudgetPeriodSetting, incomes: readonly PeriodIncome[], date: string): BudgetPeriod {
  if (setting.mode === 'monthly_from_day' && Number.isInteger(setting.startDay) && setting.startDay >= 1 && setting.startDay <= 28) {
    return monthlyFromDayPeriod(setting.startDay, date);
  }
  if (setting.mode === 'paycheck' && setting.paycheckIncomeId) {
    const income = incomes.find(item => item.id === setting.paycheckIncomeId);
    if (income && (PAYCHECK_FREQUENCIES as readonly string[]).includes(income.frequency)) {
      const period = paycheckPeriod(income, date);
      if (period) return period;
    }
  }
  return calendarPeriod(date);
}

/** Contiguous ascending periods that overlap [from, to]. Ranges over MAX_RANGE_DAYS are rejected. */
export function periodsBetween(setting: BudgetPeriodSetting, incomes: readonly PeriodIncome[], from: string, to: string): BudgetPeriod[] {
  if (to < from) return [];
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days > MAX_RANGE_DAYS) throw new RangeError(`Range is longer than ${MAX_RANGE_DAYS} days`);
  const result: BudgetPeriod[] = [];
  let period = periodOf(setting, incomes, from);
  for (;;) {
    result.push(period);
    if (period.nextStart > to) return result;
    period = periodOf(setting, incomes, period.nextStart);
  }
}
