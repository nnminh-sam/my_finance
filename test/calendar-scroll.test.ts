import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  startOfMonth,
  subMonths,
  addMonths,
  addWeeks,
  subWeeks,
} from 'date-fns';
import {
  FETCH_WEEKS_STEP,
  PRELOAD_MONTHS,
  PRELOAD_WEEKS_BUFFER,
  VISIBLE_WEEKS,
  buildCalendarWeeks,
  createInitialMonthRange,
  detectScrollDirection,
  expandMonthRange,
  getMonthFirstWeekKey,
  getNextWeeksToFetch,
  getWeekKeysInRange,
} from '../src/lib/calendarWindow';

const rootDir = new URL('..', import.meta.url);

test('initial calendar window preloads 2 months before and 2 months after the current month', () => {
  assert.equal(PRELOAD_MONTHS, 2);
  assert.equal(VISIBLE_WEEKS, 5);

  const currentDate = new Date(2026, 9, 17); // October 17, 2026
  const initialRange = createInitialMonthRange(currentDate);

  assert.equal(format(initialRange.startMonth, 'yyyy-MM'), '2026-08');
  assert.equal(format(initialRange.endMonth, 'yyyy-MM'), '2026-12');

  const { weeks, allDays } = buildCalendarWeeks(initialRange.startMonth, initialRange.endMonth);
  assert.equal(allDays.length % 7, 0, 'Total days must be an exact multiple of 7');
  assert.equal(weeks.length, allDays.length / 7);

  for (const week of weeks) {
    assert.equal(week.length, 7);
    assert.equal(week[0].getDay(), 1, 'First day of week is Monday');
    assert.equal(week[6].getDay(), 0, 'Last day of week is Sunday');
  }

  for (let i = 1; i < allDays.length; i++) {
    const diffHours = (allDays[i].getTime() - allDays[i - 1].getTime()) / (1000 * 60 * 60);
    assert.ok(diffHours >= 23 && diffHours <= 25, `Consecutive days spaced ~24h apart: ${diffHours}`);
  }
});

test('scrolling up or down dynamically expands the loaded month range while keeping a 2-month buffer', () => {
  const oct2026 = new Date(2026, 9, 17);
  const range0 = createInitialMonthRange(oct2026);
  assert.equal(format(range0.startMonth, 'yyyy-MM'), '2026-08');
  assert.equal(format(range0.endMonth, 'yyyy-MM'), '2026-12');

  // Scrolling up to September 2026 preloads July 2026 (2 months before September)
  const rangeUp = expandMonthRange(range0, subMonths(startOfMonth(oct2026), 1));
  assert.equal(format(rangeUp.startMonth, 'yyyy-MM'), '2026-07');
  assert.equal(format(rangeUp.endMonth, 'yyyy-MM'), '2026-12');

  // Scrolling down to November 2026 preloads January 2027 (2 months after November)
  const rangeDown = expandMonthRange(rangeUp, addMonths(startOfMonth(oct2026), 1));
  assert.equal(format(rangeDown.startMonth, 'yyyy-MM'), '2026-07');
  assert.equal(format(rangeDown.endMonth, 'yyyy-MM'), '2027-01');
});

test('getMonthFirstWeekKey aligns the 5-week viewport to the first week of the month on load', () => {
  const oct2026 = new Date(2026, 9, 17); // Oct 17, 2026
  const firstWeekKey = getMonthFirstWeekKey(oct2026);
  // Oct 1, 2026 is Thursday; the Monday of that week is Sep 28, 2026
  assert.equal(firstWeekKey, '2026-09-28');

  const { weeks } = buildCalendarWeeks(new Date(2026, 7, 1), new Date(2026, 11, 1));
  const startIndex = weeks.findIndex(w => format(w[0], 'yyyy-MM-dd') === firstWeekKey);
  assert.ok(startIndex >= 0, 'First week of current month exists in preloaded window');

  const visibleWeeks = weeks.slice(startIndex, startIndex + VISIBLE_WEEKS);
  assert.equal(visibleWeeks.length, 5, 'Exactly 5 weeks are visible at a time');
  // First visible week contains Oct 1 and 5th visible week contains Oct 31
  assert.equal(format(visibleWeeks[0][3], 'yyyy-MM-dd'), '2026-10-01');
  assert.equal(format(visibleWeeks[4][5], 'yyyy-MM-dd'), '2026-10-31');
});

test('detectScrollDirection and getNextWeeksToFetch fetch week batches based on scroll direction and visible week', () => {
  assert.equal(detectScrollDirection(120, 200), 'up');
  assert.equal(detectScrollDirection(280, 200), 'down');
  assert.equal(detectScrollDirection(200, 200), 'idle');

  const baseMonday = new Date(2026, 8, 28); // 2026-09-28
  const fetchedBounds = {
    startWeek: subWeeks(baseMonday, 4), // 2026-08-31
    endWeek: addWeeks(baseMonday, 8),   // 2026-11-23
  };

  // Visible window well within fetched buffer: no fetch needed
  const noFetch = getNextWeeksToFetch({
    direction: 'down',
    visibleStartWeek: baseMonday,
    visibleEndWeek: addWeeks(baseMonday, 2),
    fetchedBounds,
    bufferWeeks: PRELOAD_WEEKS_BUFFER,
    fetchStepWeeks: FETCH_WEEKS_STEP,
  });
  assert.equal(noFetch, null);

  // User scrolls up so top visible week is within buffer of fetchedBounds.startWeek
  const upVisibleStart = subWeeks(baseMonday, 2); // 2 weeks from fetchedBounds.startWeek (<= buffer 4)
  const upBatch = getNextWeeksToFetch({
    direction: 'up',
    visibleStartWeek: upVisibleStart,
    visibleEndWeek: addWeeks(upVisibleStart, 4),
    fetchedBounds,
    bufferWeeks: 4,
    fetchStepWeeks: 3,
  });
  assert.ok(upBatch, 'Should request earlier week batch when scrolling up near fetched boundary');
  assert.equal(upBatch.startDate, '2026-08-10');
  assert.equal(upBatch.endDate, '2026-08-30');
  assert.equal(upBatch.weekKeys.length, 3);
  assert.deepEqual(upBatch.weekKeys, ['2026-08-10', '2026-08-17', '2026-08-24']);

  // User scrolls down so bottom visible week is within buffer of fetchedBounds.endWeek
  const downVisibleEnd = addWeeks(baseMonday, 6); // 2 weeks from fetchedBounds.endWeek (<= buffer 4)
  const downBatch = getNextWeeksToFetch({
    direction: 'down',
    visibleStartWeek: subWeeks(downVisibleEnd, 4),
    visibleEndWeek: downVisibleEnd,
    fetchedBounds: upBatch.nextBounds,
    bufferWeeks: 4,
    fetchStepWeeks: 3,
  });
  assert.ok(downBatch, 'Should request later week batch when scrolling down near fetched boundary');
  assert.equal(downBatch.startDate, '2026-11-30');
  assert.equal(downBatch.endDate, '2026-12-20');
  assert.equal(downBatch.weekKeys.length, 3);
  assert.deepEqual(downBatch.weekKeys, getWeekKeysInRange(new Date(2026, 10, 30), new Date(2026, 11, 14)));
});

test('week dominant month correctly maps week rows across month boundaries using Thursday (week[3])', () => {
  const boundaryDate = new Date(2026, 9, 29); // Oct 29, 2026 (Thursday)
  const weekStart = startOfWeek(boundaryDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(boundaryDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  assert.equal(format(weekDays[0], 'yyyy-MM-dd'), '2026-10-26');
  assert.equal(format(weekDays[3], 'yyyy-MM-dd'), '2026-10-29'); // Thursday
  assert.equal(format(weekDays[6], 'yyyy-MM-dd'), '2026-11-01'); // Sunday is Nov 1

  const dominantMonth = format(weekDays[3], 'yyyy-MM');
  assert.equal(dominantMonth, '2026-10');

  const nextWeekThursday = new Date(2026, 10, 5); // Nov 5, 2026 (Thursday)
  const nextWeekStart = startOfWeek(nextWeekThursday, { weekStartsOn: 1 });
  const nextWeekEnd = endOfWeek(nextWeekThursday, { weekStartsOn: 1 });
  const nextWeekDays = eachDayOfInterval({ start: nextWeekStart, end: nextWeekEnd });

  assert.equal(format(nextWeekDays[0], 'yyyy-MM-dd'), '2026-11-02');
  assert.equal(format(nextWeekDays[3], 'yyyy-MM'), '2026-11');
});

test('CalendarView CSS sizes week rows to display 5 weeks at a time in the scrollable grid', () => {
  const css = readFileSync(new URL('src/styles/CalendarView.css', rootDir), 'utf8');
  assert.match(css, /calc\(\(100%\s*-\s*32px\)\s*\/\s*5\)/, 'Desktop week rows take 1/5 of container height');
  assert.match(css, /calc\(\(100%\s*-\s*16px\)\s*\/\s*5\)/, 'Mobile week rows take 1/5 of container height');
});
