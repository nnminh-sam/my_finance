import {
  addMonths,
  addWeeks,
  differenceInCalendarWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getISOWeek,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns';

export const PRELOAD_MONTHS = 2;
export const VISIBLE_WEEKS = 5;
export const WEEKS_PER_MONTH = 5;
export const PRELOAD_WEEKS_BUFFER = 4;
export const FETCH_WEEKS_STEP = 3;

export type ScrollDirection = 'up' | 'down' | 'left' | 'right' | 'idle';
export type WeekRenderStage = 'dates' | 'totals' | 'details';

export interface MonthRange {
  startMonth: Date;
  endMonth: Date;
}

export interface CalendarMonthPage {
  monthDate: Date;
  monthKey: string;
  weeks: Date[][];
  days: Date[];
}

export interface FetchedWeekBounds {
  startWeek: Date;
  endWeek: Date;
}

export interface WeekFetchBatch {
  startDate: string;
  endDate: string;
  weekKeys: string[];
  nextBounds: FetchedWeekBounds;
}

export function detectScrollDirection(
  currentScrollOffset: number,
  previousScrollOffset: number,
): ScrollDirection {
  if (currentScrollOffset < previousScrollOffset) return 'up';
  if (currentScrollOffset > previousScrollOffset) return 'down';
  return 'idle';
}

export function getWeekOfYear(dateInWeek: Date): number {
  return getISOWeek(startOfWeek(dateInWeek, { weekStartsOn: 1 }));
}

export function formatWeekOfYear(dateInWeek: Date): string {
  return String(getWeekOfYear(dateInWeek));
}

export function createInitialMonthRange(
  baseDate: Date = new Date(),
  preloadMonths: number = PRELOAD_MONTHS,
): MonthRange {
  const currentMonth = startOfMonth(baseDate);
  return {
    startMonth: startOfMonth(subMonths(currentMonth, preloadMonths)),
    endMonth: startOfMonth(addMonths(currentMonth, preloadMonths)),
  };
}

export function expandMonthRange(
  range: MonthRange,
  activeMonthDate: Date,
  preloadMonths: number = PRELOAD_MONTHS,
): MonthRange {
  const requiredStart = startOfMonth(subMonths(activeMonthDate, preloadMonths));
  const requiredEnd = startOfMonth(addMonths(activeMonthDate, preloadMonths));

  const nextStart = requiredStart.getTime() < range.startMonth.getTime() ? requiredStart : range.startMonth;
  const nextEnd = requiredEnd.getTime() > range.endMonth.getTime() ? requiredEnd : range.endMonth;

  if (
    nextStart.getTime() === range.startMonth.getTime() &&
    nextEnd.getTime() === range.endMonth.getTime()
  ) {
    return range;
  }

  return {
    startMonth: nextStart,
    endMonth: nextEnd,
  };
}

export function buildMonthWeeks(
  monthDate: Date,
  weeksCount: number = WEEKS_PER_MONTH,
): {
  weeks: Date[][];
  days: Date[];
} {
  const firstWeekStart = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 });
  const lastWeekEnd = endOfWeek(addWeeks(firstWeekStart, weeksCount - 1), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: firstWeekStart, end: lastWeekEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return { weeks, days };
}

export function buildCalendarMonths(
  startMonth: Date,
  endMonth: Date,
  weeksPerMonth: number = WEEKS_PER_MONTH,
): {
  months: CalendarMonthPage[];
  allDays: Date[];
} {
  const months: CalendarMonthPage[] = [];
  const seenDays = new Map<string, Date>();
  let cursor = startOfMonth(startMonth);
  const last = startOfMonth(endMonth);

  while (cursor.getTime() <= last.getTime()) {
    const monthDate = cursor;
    const monthKey = format(monthDate, 'yyyy-MM');
    const { weeks, days } = buildMonthWeeks(monthDate, weeksPerMonth);
    months.push({ monthDate, monthKey, weeks, days });
    for (const day of days) {
      const key = format(day, 'yyyy-MM-dd');
      if (!seenDays.has(key)) {
        seenDays.set(key, day);
      }
    }
    cursor = startOfMonth(addMonths(cursor, 1));
  }

  const allDays = Array.from(seenDays.values()).sort((a, b) => a.getTime() - b.getTime());
  return { months, allDays };
}

export function buildCalendarWeeks(startMonth: Date, endMonth: Date): {
  weeks: Date[][];
  allDays: Date[];
} {
  const rangeStartDate = startOfWeek(startOfMonth(startMonth), { weekStartsOn: 1 });
  const rangeEndDate = endOfWeek(endOfMonth(endMonth), { weekStartsOn: 1 });

  const allDays = eachDayOfInterval({ start: rangeStartDate, end: rangeEndDate });
  const weeks: Date[][] = [];
  for (let i = 0; i < allDays.length; i += 7) {
    weeks.push(allDays.slice(i, i + 7));
  }
  return { weeks, allDays };
}

/** One calendar page: a whole budget period (a month or a pay cycle), shown week by week. */
export interface CalendarPeriodPage {
  key: string; // the period's first day, YYYY-MM-DD
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
  weeks: Date[][]; // Monday to Sunday, from the week of `start` to the week of `end` (5 or 6 for a month-long period)
  days: Date[];
}

/**
 * Pages for consecutive periods. Each page holds every week the period touches, so no day of the period
 * falls onto another page; days of the neighbouring periods fill the first and last week.
 */
export function buildPeriodPages(periods: readonly { start: string; end: string }[]): {
  pages: CalendarPeriodPage[];
  allDays: Date[];
} {
  const seenDays = new Map<string, Date>();
  const pages = periods.map(({ start, end }) => {
    const first = startOfWeek(parseISO(start), { weekStartsOn: 1 });
    const last = endOfWeek(parseISO(end), { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: first, end: last });
    const weeks: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    for (const day of days) {
      const key = format(day, 'yyyy-MM-dd');
      if (!seenDays.has(key)) seenDays.set(key, day);
    }
    return { key: start, start, end, weeks, days };
  });
  const allDays = Array.from(seenDays.values()).sort((a, b) => a.getTime() - b.getTime());
  return { pages, allDays };
}

export function getMonthFirstWeekKey(monthDate: Date): string {
  return format(startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

export function getWeekKeysInRange(startWeekMonday: Date, endWeekMonday: Date): string[] {
  const start = startOfWeek(startWeekMonday, { weekStartsOn: 1 });
  const end = startOfWeek(endWeekMonday, { weekStartsOn: 1 });
  const keys: string[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    keys.push(format(cursor, 'yyyy-MM-dd'));
    cursor = addWeeks(cursor, 1);
  }
  return keys;
}

/**
 * Compares the user's current visible week against the already-fetched week bounds
 * in the detected scroll direction and returns the next week batch to fetch if needed.
 */
export function getNextWeeksToFetch(params: {
  direction: ScrollDirection;
  visibleStartWeek: Date;
  visibleEndWeek: Date;
  fetchedBounds: FetchedWeekBounds;
  bufferWeeks?: number;
  fetchStepWeeks?: number;
}): WeekFetchBatch | null {
  const {
    direction,
    visibleStartWeek,
    visibleEndWeek,
    fetchedBounds,
    bufferWeeks = PRELOAD_WEEKS_BUFFER,
    fetchStepWeeks = FETCH_WEEKS_STEP,
  } = params;

  const visStart = startOfWeek(visibleStartWeek, { weekStartsOn: 1 });
  const visEnd = startOfWeek(visibleEndWeek, { weekStartsOn: 1 });
  const fetchedStart = startOfWeek(fetchedBounds.startWeek, { weekStartsOn: 1 });
  const fetchedEnd = startOfWeek(fetchedBounds.endWeek, { weekStartsOn: 1 });

  if (direction === 'up' || direction === 'left') {
    const weeksAheadUp = differenceInCalendarWeeks(visStart, fetchedStart, { weekStartsOn: 1 });
    if (weeksAheadUp <= bufferWeeks) {
      const targetStartWeek = subWeeks(
        visStart.getTime() < fetchedStart.getTime() ? visStart : fetchedStart,
        fetchStepWeeks,
      );
      const batchEndWeek = subWeeks(fetchedStart, 1);
      if (targetStartWeek.getTime() <= batchEndWeek.getTime()) {
        return {
          startDate: format(targetStartWeek, 'yyyy-MM-dd'),
          endDate: format(endOfWeek(batchEndWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
          weekKeys: getWeekKeysInRange(targetStartWeek, batchEndWeek),
          nextBounds: {
            startWeek: targetStartWeek,
            endWeek: fetchedEnd,
          },
        };
      }
    }
  } else if (direction === 'down' || direction === 'right') {
    const weeksAheadDown = differenceInCalendarWeeks(fetchedEnd, visEnd, { weekStartsOn: 1 });
    if (weeksAheadDown <= bufferWeeks) {
      const batchStartWeek = addWeeks(fetchedEnd, 1);
      const targetEndWeek = addWeeks(
        visEnd.getTime() > fetchedEnd.getTime() ? visEnd : fetchedEnd,
        fetchStepWeeks,
      );
      if (batchStartWeek.getTime() <= targetEndWeek.getTime()) {
        return {
          startDate: format(batchStartWeek, 'yyyy-MM-dd'),
          endDate: format(endOfWeek(targetEndWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
          weekKeys: getWeekKeysInRange(batchStartWeek, targetEndWeek),
          nextBounds: {
            startWeek: fetchedStart,
            endWeek: targetEndWeek,
          },
        };
      }
    }
  }

  return null;
}
