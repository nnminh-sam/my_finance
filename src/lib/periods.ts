// Budget periods: the span of days a plan or summary is grouped by.
//
// Pure date math shared by the server and the browser. `calendar` is the calendar month,
// `monthly_from_day` starts a period on a fixed day of each month, and `paycheck` starts a period on
// each (weekend-shifted) payday of one chosen income, extrapolated before its start date and after its
// end date so every day belongs to a period.

import { daysInMonth, getRangeIncome, incomePaydays, type IncomeSchedule } from './income';
import type { Income } from '../types';
import { addDays, MAX_RANGE_DAYS } from './plans';

export const BUDGET_PERIOD_MODES = ['calendar', 'monthly_from_day', 'paycheck'] as const;
export type BudgetPeriodMode = typeof BUDGET_PERIOD_MODES[number];

/** Which period Calendar, Week, Day, Analytics and the phone screens group by. */
export const SHOW_BY = ['calendar_month', 'pay_cycle'] as const;
export type ShowBy = typeof SHOW_BY[number];
export const DEFAULT_SHOW_BY: ShowBy = 'calendar_month';

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

export function calendarPeriod(date: string): BudgetPeriod {
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

type PeriodResolver = (date: string) => BudgetPeriod;

/** The period a view groups by: the saved budget period for `pay_cycle`, the calendar month otherwise. */
export function viewPeriodOf(setting: BudgetPeriodSetting, showBy: ShowBy, incomes: readonly PeriodIncome[], date: string): BudgetPeriod {
  return showBy === 'pay_cycle' ? periodOf(setting, incomes, date) : calendarPeriod(date);
}

/** Income paid in the view period that contains `date`: the calendar month, or the pay period for Show by "Pay cycle". */
export function viewPeriodIncome(setting: BudgetPeriodSetting, showBy: ShowBy, incomes: readonly Income[], date: string) {
  const period = viewPeriodOf(setting, showBy, incomes, date);
  return getRangeIncome(period.start, period.end, incomes);
}

/** The period before or after `period`, found with the same resolver that produced it. */
export function adjacentPeriod(resolve: PeriodResolver, period: BudgetPeriod, direction: 'previous' | 'next'): BudgetPeriod {
  return resolve(adjacentPeriodDate(period, direction));
}

/** A date inside the period before or after `period`: the day before it starts, or the day the next one starts. */
export function adjacentPeriodDate(period: Pick<BudgetPeriod, 'start' | 'nextStart'>, direction: 'previous' | 'next'): string {
  return direction === 'previous' ? addDays(period.start, -1) : period.nextStart;
}

/**
 * First and last day of every budget period overlapping [from, to], for Calendar markers.
 * Both sets are empty in calendar mode: a plain calendar month needs no marker.
 */
export function markerSets(setting: BudgetPeriodSetting, incomes: readonly PeriodIncome[], from: string, to: string): { starts: Set<string>; ends: Set<string> } {
  const starts = new Set<string>();
  const ends = new Set<string>();
  // periodsBetween rejects ranges over MAX_RANGE_DAYS, so a long window is walked in chunks and never throws.
  for (let cursor = from; cursor <= to;) {
    const chunkEnd = addDays(cursor, MAX_RANGE_DAYS) < to ? addDays(cursor, MAX_RANGE_DAYS) : to;
    for (const period of periodsBetween(setting, incomes, cursor, chunkEnd)) {
      if (period.mode === 'calendar') continue;
      starts.add(period.start);
      ends.add(period.end);
    }
    cursor = addDays(chunkEnd, 1);
  }
  return { starts, ends };
}

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

/** A `?period=` value: a real YYYY-MM-DD date, else null (callers fall back to the current period). */
export function parsePeriodParam(value: string | null | undefined): string | null {
  if (!value || !DATE_PARAM.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

/** A period is past when it ended before `today`; the period containing today is not past. */
export function isPastPeriod(period: Pick<BudgetPeriod, 'end'>, today: string): boolean {
  return period.end < today;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Day-first label for a YYYY-MM-DD date, e.g. `25 Nov`; the same text in every runtime locale. */
export function periodDayLabel(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTH_ABBR[Number(date.slice(5, 7)) - 1]}`;
}

/** Day-first label for a period range, e.g. `25 Nov – 24 Dec` (`withYear` appends the end date's year). */
export function periodRangeLabel(period: Pick<BudgetPeriod, 'start' | 'end'>, withYear = false): string {
  return `${periodDayLabel(period.start)} – ${periodDayLabel(period.end)}${withYear ? ` ${period.end.slice(0, 4)}` : ''}`;
}
