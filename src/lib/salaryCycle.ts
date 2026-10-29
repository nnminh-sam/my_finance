import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getDaysInMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { Spending } from '../types';

export const DEFAULT_SALARY_DAY = 5;
export const salaryCycleStorageKey = (userId?: string) =>
  `tracker_salary_cycle_v1_${userId || 'default'}`;

export interface SalaryCycleConfig {
  /** Configurable day of month (1 to 28, default 5) */
  salaryDay: number;
  /** Automatically shift payday to Monday when it falls on Saturday or Sunday */
  shiftWeekendToMonday: boolean;
  /** Include the next month's payday as the end of the cycle (instead of the day before) */
  includeNextPaydayInCycle: boolean;
  /** Start the pay cycle on the day after payday (defaults to true) */
  startDayAfterPayday: boolean;
  /** Month-specific extra delay in days (or negative for early payout), keyed by 'YYYY-MM' */
  monthDelays: Record<string, number>;
}

export interface SalaryCycleRange {
  /** Cycle identifier 'YYYY-MM' (corresponding to the starting payday month) */
  cycleMonth: string;
  /** The base configured payday before weekend/delay adjustments */
  nominalStartDate: Date;
  /** Actual payday of this month (before startDayAfterPayday shift) */
  actualPayday: Date;
  /** Actual start date of this salary cycle (inclusive) */
  startDate: Date;
  /** Actual end date of this salary cycle (inclusive) */
  endDate: Date;
  /** Next cycle's actual payday date */
  nextStartDate: Date;
  /** Number of days shifted due to weekend rule on the start date */
  weekendShiftDays: number;
  /** User-configured delay days for this specific cycle month */
  manualDelayDays: number;
  /** Total days shifted from nominal start date */
  totalShiftDays: number;
  /** All calendar days belonging to this salary cycle */
  days: Date[];
  /** Calendar weeks (Mon-Sun) covering the entire salary cycle */
  weeks: Date[][];
}

export function defaultSalaryCycleConfig(): SalaryCycleConfig {
  return {
    salaryDay: DEFAULT_SALARY_DAY,
    shiftWeekendToMonday: true,
    includeNextPaydayInCycle: true,
    startDayAfterPayday: true,
    monthDelays: {},
  };
}

export function clampSalaryDay(day: number): number {
  if (!Number.isFinite(day)) return DEFAULT_SALARY_DAY;
  return Math.max(1, Math.min(28, Math.round(day)));
}

export function clampDelayDays(delay: number): number {
  if (!Number.isFinite(delay)) return 0;
  return Math.max(-7, Math.min(14, Math.round(delay)));
}

export function loadSalaryCycleConfig(userId?: string): SalaryCycleConfig {
  if (typeof window === 'undefined') return defaultSalaryCycleConfig();
  try {
    const raw = window.localStorage.getItem(salaryCycleStorageKey(userId));
    if (!raw) return defaultSalaryCycleConfig();
    const parsed = JSON.parse(raw) as Partial<SalaryCycleConfig>;
    const salaryDay = clampSalaryDay(parsed.salaryDay ?? DEFAULT_SALARY_DAY);
    const shiftWeekendToMonday =
      typeof parsed.shiftWeekendToMonday === 'boolean' ? parsed.shiftWeekendToMonday : true;
    const includeNextPaydayInCycle =
      typeof parsed.includeNextPaydayInCycle === 'boolean' ? parsed.includeNextPaydayInCycle : true;
    const startDayAfterPayday =
      typeof parsed.startDayAfterPayday === 'boolean' ? parsed.startDayAfterPayday : true;
    const monthDelays: Record<string, number> = {};
    if (parsed.monthDelays && typeof parsed.monthDelays === 'object') {
      for (const [k, v] of Object.entries(parsed.monthDelays)) {
        if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(k) && typeof v === 'number' && Number.isFinite(v)) {
          const clamped = clampDelayDays(v);
          if (clamped !== 0) monthDelays[k] = clamped;
        }
      }
    }
    return {
      salaryDay,
      shiftWeekendToMonday,
      includeNextPaydayInCycle,
      startDayAfterPayday,
      monthDelays,
    };
  } catch {
    return defaultSalaryCycleConfig();
  }
}

export function saveSalaryCycleConfig(config: SalaryCycleConfig, userId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(salaryCycleStorageKey(userId), JSON.stringify(config));
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

/**
 * Computes the actual payday start date for a given month ('YYYY-MM' or Date).
 */
export function getPaydayForMonth(
  monthDate: Date,
  config: SalaryCycleConfig,
): {
  nominalDate: Date;
  actualDate: Date;
  weekendShiftDays: number;
  manualDelayDays: number;
  totalShiftDays: number;
} {
  const mStart = startOfMonth(monthDate);
  const monthKey = format(mStart, 'yyyy-MM');
  const maxDay = getDaysInMonth(mStart);
  const day = Math.min(clampSalaryDay(config.salaryDay), maxDay);

  const nominalDate = new Date(mStart.getFullYear(), mStart.getMonth(), day);
  let weekendShiftDays = 0;

  if (config.shiftWeekendToMonday) {
    const dow = nominalDate.getDay(); // 0 = Sun, 6 = Sat
    if (dow === 6) weekendShiftDays = 2; // Saturday -> Monday (+2d)
    else if (dow === 0) weekendShiftDays = 1; // Sunday -> Monday (+1d)
  }

  const manualDelayDays = clampDelayDays(config.monthDelays[monthKey] ?? 0);
  const totalShiftDays = weekendShiftDays + manualDelayDays;
  const actualDate = addDays(nominalDate, totalShiftDays);

  return {
    nominalDate,
    actualDate,
    weekendShiftDays,
    manualDelayDays,
    totalShiftDays,
  };
}

/**
 * Computes the complete SalaryCycleRange for the cycle anchored at `monthDate` ('YYYY-MM').
 * E.g. for October 2026: starts on Oct payday (e.g. Oct 5) and ends the day before Nov payday (e.g. Nov 4, or Nov 8 if Nov payday is delayed).
 */
export function getSalaryCycleForMonth(
  monthDate: Date,
  config: SalaryCycleConfig,
): SalaryCycleRange {
  const currentMonthStart = startOfMonth(monthDate);
  const nextMonthStart = startOfMonth(addMonths(currentMonthStart, 1));
  const cycleMonth = format(currentMonthStart, 'yyyy-MM');

  const currentPayday = getPaydayForMonth(currentMonthStart, config);
  const nextPayday = getPaydayForMonth(nextMonthStart, config);

  const startDayAfter = config.startDayAfterPayday ?? true;
  const startDate = startDayAfter
    ? addDays(currentPayday.actualDate, 1)
    : currentPayday.actualDate;

  // When cycle starts the day after payday, cycle end is always on next payday
  const includePaydayAsEnd = startDayAfter
    ? true
    : (config.includeNextPaydayInCycle ?? true);

  // Ensure endDate is at least startDate even in extreme configuration cases
  const rawEndDate = includePaydayAsEnd
    ? nextPayday.actualDate
    : addDays(nextPayday.actualDate, -1);
  const endDate = rawEndDate.getTime() >= startDate.getTime() ? rawEndDate : startDate;

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const calendarStart = startOfWeek(startDate, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(endDate, { weekStartsOn: 1 });
  const allGridDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < allGridDays.length; i += 7) {
    weeks.push(allGridDays.slice(i, i + 7));
  }

  return {
    cycleMonth,
    nominalStartDate: currentPayday.nominalDate,
    actualPayday: currentPayday.actualDate,
    startDate,
    endDate,
    nextStartDate: nextPayday.actualDate,
    weekendShiftDays: currentPayday.weekendShiftDays,
    manualDelayDays: currentPayday.manualDelayDays,
    totalShiftDays: currentPayday.totalShiftDays,
    days,
    weeks,
  };
}

export function isDateInSalaryCycle(date: Date, cycle: SalaryCycleRange): boolean {
  const dateStr = format(date, 'yyyy-MM-dd');
  const startStr = format(cycle.startDate, 'yyyy-MM-dd');
  const endStr = format(cycle.endDate, 'yyyy-MM-dd');
  return dateStr >= startStr && dateStr <= endStr;
}

export function getSpendingsForSalaryCycle(
  cycle: SalaryCycleRange,
  spendings: readonly Spending[],
): Spending[] {
  const startStr = format(cycle.startDate, 'yyyy-MM-dd');
  const endStr = format(cycle.endDate, 'yyyy-MM-dd');
  return spendings.filter((s) => s.date >= startStr && s.date <= endStr);
}

/**
 * Given a reference date (like today), resolves which salary cycle month Date it falls into
 * when navigating by today, or returns the start of the given month.
 */
export function resolveActiveCycleMonthDate(
  referenceDate: Date,
  config: SalaryCycleConfig,
): Date {
  const mStart = startOfMonth(referenceDate);
  const payday = getPaydayForMonth(mStart, config);
  const startDayAfter = config.startDayAfterPayday ?? true;
  const cycleStart = startDayAfter
    ? addDays(payday.actualDate, 1)
    : payday.actualDate;
  const refStr = format(referenceDate, 'yyyy-MM-dd');
  const startStr = format(cycleStart, 'yyyy-MM-dd');
  if (refStr < startStr) {
    return startOfMonth(addMonths(mStart, -1));
  }
  return mStart;
}

export function parseCycleMonth(cycleMonth: string, fallback = new Date()): Date {
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(cycleMonth)) {
    return parseISO(`${cycleMonth}-01`);
  }
  return startOfMonth(fallback);
}
