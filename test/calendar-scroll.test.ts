import assert from 'node:assert/strict';
import test from 'node:test';
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  subMonths,
  addMonths,
} from 'date-fns';

test('continuous calendar weeks generate seamless 7-day rows without gaps or duplicates', () => {
  const currentDate = new Date(2026, 9, 17); // October 17, 2026
  const startRangeMonth = startOfMonth(subMonths(currentDate, 6));
  const endRangeMonth = endOfMonth(addMonths(currentDate, 6));
  const rangeStartDate = startOfWeek(startRangeMonth, { weekStartsOn: 1 });
  const rangeEndDate = endOfWeek(endRangeMonth, { weekStartsOn: 1 });

  const allDays = eachDayOfInterval({ start: rangeStartDate, end: rangeEndDate });
  assert.equal(allDays.length % 7, 0, 'Total days must be an exact multiple of 7');

  const weeks: Date[][] = [];
  for (let i = 0; i < allDays.length; i += 7) {
    weeks.push(allDays.slice(i, i + 7));
  }

  assert.ok(weeks.length > 50, 'Window spans more than 50 continuous weeks');

  for (const week of weeks) {
    assert.equal(week.length, 7);
    // Week starts on Monday (day index 1) and ends on Sunday (day index 0)
    assert.equal(week[0].getDay(), 1, 'First day of week is Monday');
    assert.equal(week[6].getDay(), 0, 'Last day of week is Sunday');
  }

  // Verify consecutive days with no gaps
  for (let i = 1; i < allDays.length; i++) {
    const diffHours = (allDays[i].getTime() - allDays[i - 1].getTime()) / (1000 * 60 * 60);
    assert.ok(diffHours >= 23 && diffHours <= 25, `Consecutive days spaced ~24h apart: ${diffHours}`);
  }
});

test('week dominant month correctly maps week rows across month boundaries using Thursday (week[3])', () => {
  // October 2026 ends on Saturday Oct 31, and November 1 2026 is Sunday
  // Week: Oct 26 (Mon) to Nov 1 (Sun)
  const boundaryDate = new Date(2026, 9, 29); // Oct 29, 2026 (Thursday)
  const weekStart = startOfWeek(boundaryDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(boundaryDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  assert.equal(format(weekDays[0], 'yyyy-MM-dd'), '2026-10-26');
  assert.equal(format(weekDays[3], 'yyyy-MM-dd'), '2026-10-29'); // Thursday
  assert.equal(format(weekDays[6], 'yyyy-MM-dd'), '2026-11-01'); // Sunday is Nov 1

  // Majority of days (6 out of 7) are October, Thursday is October
  const dominantMonth = format(weekDays[3], 'yyyy-MM');
  assert.equal(dominantMonth, '2026-10');

  // Next week: Nov 2 (Mon) to Nov 8 (Sun)
  const nextWeekThursday = new Date(2026, 10, 5); // Nov 5, 2026 (Thursday)
  const nextWeekStart = startOfWeek(nextWeekThursday, { weekStartsOn: 1 });
  const nextWeekEnd = endOfWeek(nextWeekThursday, { weekStartsOn: 1 });
  const nextWeekDays = eachDayOfInterval({ start: nextWeekStart, end: nextWeekEnd });

  assert.equal(format(nextWeekDays[0], 'yyyy-MM-dd'), '2026-11-02');
  assert.equal(format(nextWeekDays[3], 'yyyy-MM'), '2026-11');
});
