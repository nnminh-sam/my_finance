import {
  addMonths,
  addWeeks,
  differenceInCalendarWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns';

export const PRELOAD_MONTHS = 2;
export const VISIBLE_WEEKS = 5;
export const PRELOAD_WEEKS_BUFFER = 4;
export const FETCH_WEEKS_STEP = 3;

export type ScrollDirection = 'up' | 'down' | 'idle';
export type WeekRenderStage = 'dates' | 'totals' | 'details';

export interface MonthRange {
  startMonth: Date;
  endMonth: Date;
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
  currentScrollTop: number,
  previousScrollTop: number,
): ScrollDirection {
  if (currentScrollTop < previousScrollTop) return 'up';
  if (currentScrollTop > previousScrollTop) return 'down';
  return 'idle';
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

  if (direction === 'up') {
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
  } else if (direction === 'down') {
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
