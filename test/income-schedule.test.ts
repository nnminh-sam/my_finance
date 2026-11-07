import assert from 'node:assert/strict';
import test from 'node:test';
import { countIncomeOccurrences, daysInMonth, DAY_MS, describeIncomeSchedule, getMonthIncome, incomePaydays, monthRange, toUtc, utcDate } from '../src/lib/income';
import type { Income, IncomeScheduleFrequency } from '../src/types';

function income(frequency: IncomeScheduleFrequency, startDate: string, extra: Partial<Income> = {}): Income {
  return { id: 'i', source: 'Salary', name: '', amount: 100, frequency, startDate, endDate: null, ...extra };
}

const inMonth = (value: Income, month: string) => {
  const { start, end } = monthRange(month);
  return countIncomeOccurrences(value, start, end);
};
const paidIn = (value: Income, start: string, end: string) => incomePaydays(value, start, end).map(payday => payday.paid);

// A frozen copy of countIncomeOccurrences as it was before pay schedules existed.
function previousCount(value: Pick<Income, 'frequency' | 'startDate' | 'endDate'>, rangeStart: string, rangeEnd: string): number {
  const start = toUtc(value.startDate);
  const windowStart = Math.max(start, toUtc(rangeStart));
  const windowEnd = Math.min(value.endDate ? toUtc(value.endDate) : Infinity, toUtc(rangeEnd));
  if (windowEnd < windowStart) return 0;
  switch (value.frequency) {
    case 'once':
      return start >= toUtc(rangeStart) ? 1 : 0;
    case 'daily':
      return Math.round((windowEnd - windowStart) / DAY_MS) + 1;
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
          if (value.frequency === 'yearly' && monthIndex !== anchor.getUTCMonth()) continue;
          const payday = utcDate(year, monthIndex, Math.min(anchorDay, daysInMonth(year, monthIndex)));
          if (payday >= windowStart && payday <= windowEnd) count++;
        }
      }
      return count;
    }
    default:
      throw new Error('not an original frequency');
  }
}

test('incomes without schedule options count exactly as before (differential)', () => {
  const frequencies = ['once', 'daily', 'weekly', 'monthly', 'yearly'] as const;
  const starts = ['2020-01-06', '2023-01-31', '2024-02-29', '2025-12-31', '2026-03-01', '2028-02-29'];
  const ends = [null, '2025-06-30', '2027-02-28', '2024-02-29'];
  const ranges: [string, string][] = [];
  for (let year = 2019; year <= 2029; year++) {
    for (let month = 1; month <= 12; month++) {
      const { start, end } = monthRange(`${year}-${String(month).padStart(2, '0')}`);
      ranges.push([start, end]);
    }
  }
  ranges.push(['2019-01-01', '2029-12-31'], ['2024-02-29', '2024-02-29'], ['2026-05-10', '2026-05-09'], ['2023-12-25', '2024-03-05']);
  let compared = 0;
  for (const frequency of frequencies) {
    for (const startDate of starts) {
      for (const endDate of ends) {
        if (endDate !== null && endDate < startDate) continue;
        if (frequency === 'once' && endDate !== null) continue;
        const value = income(frequency, startDate, { endDate });
        for (const [start, end] of ranges) {
          assert.equal(countIncomeOccurrences(value, start, end), previousCount(value, start, end), `${frequency} ${startDate} ${endDate} ${start}..${end}`);
          compared++;
        }
      }
    }
  }
  assert.ok(compared > 5000);
  // Explicit defaults take the same path as missing fields.
  assert.equal(countIncomeOccurrences(income('weekly', '2026-01-05', { interval: 1, weekendShift: false }), '2026-01-01', '2026-01-31'), 4);
});

test('every 2 and 4 weeks use a stride of 14 and 28 days', () => {
  const biweekly = income('weekly', '2026-01-02', { interval: 2 });
  assert.deepEqual(paidIn(biweekly, '2026-01-02', '2026-02-12'), ['2026-01-02', '2026-01-16', '2026-01-30']);
  assert.equal(countIncomeOccurrences(biweekly, '2026-01-05', '2026-01-15'), 0, 'an off-week day is not a payday');
  assert.equal(countIncomeOccurrences(income('weekly', '2026-01-02'), '2026-01-05', '2026-01-15'), 1, 'interval 1 keeps the old counts');
  const year = (value: Income) => countIncomeOccurrences(value, '2026-01-01', '2026-12-31');
  assert.equal(year(income('weekly', '2026-01-02', { interval: 4 })), 13);
  assert.equal(year(income('weekly', '2026-01-01', { interval: 4 })), 14);
  assert.equal(year(income('weekly', '2026-01-02', { interval: 2 })), 26);
  assert.equal(year(income('weekly', '2026-01-01', { interval: 2 })), 27);
  // The start and end dates still bound the schedule.
  assert.equal(countIncomeOccurrences(income('weekly', '2026-03-06', { interval: 2, endDate: '2026-04-03' }), '2026-01-01', '2026-12-31'), 3);
  assert.equal(countIncomeOccurrences(biweekly, '2025-01-01', '2025-12-31'), 0);
});

test('twice a month clamps both days to the month length and keeps clamped duplicates', () => {
  const pay = income('semimonthly', '2026-01-01', { semimonthlyDays: [15, 31] });
  assert.deepEqual(paidIn(pay, '2026-02-01', '2026-02-28'), ['2026-02-15', '2026-02-28']);
  assert.deepEqual(paidIn(pay, '2026-04-01', '2026-04-30'), ['2026-04-15', '2026-04-30']);
  assert.deepEqual(paidIn(pay, '2026-01-01', '2026-01-31'), ['2026-01-15', '2026-01-31']);
  assert.deepEqual(paidIn(pay, '2028-02-01', '2028-02-29'), ['2028-02-15', '2028-02-29']);
  assert.deepEqual(paidIn(income('semimonthly', '2026-01-01', { semimonthlyDays: [1, 16] }), '2026-02-01', '2026-02-28'), ['2026-02-01', '2026-02-16']);
  // 30 and 31 both land on February 28: two payments on the same date, so the monthly total stays constant.
  const both = income('semimonthly', '2026-01-01', { semimonthlyDays: [30, 31] });
  assert.deepEqual(paidIn(both, '2026-02-01', '2026-02-28'), ['2026-02-28', '2026-02-28']);
  assert.deepEqual(paidIn(both, '2026-03-01', '2026-03-31'), ['2026-03-30', '2026-03-31']);
  assert.equal(getMonthIncome('2026-02', [both]).totalIncome, 200);
  // The start date applies to the nominal day.
  assert.deepEqual(paidIn(income('semimonthly', '2026-02-10', { semimonthlyDays: [5, 20] }), '2026-02-01', '2026-02-28'), ['2026-02-20']);
  assert.deepEqual(paidIn(income('semimonthly', '2026-01-01', { semimonthlyDays: [5, 20], endDate: '2026-02-10' }), '2026-02-01', '2026-02-28'), ['2026-02-05']);
});

test('the weekend shift pays Saturday and Sunday paydays on the Friday before', () => {
  // 2026-08-01 is a Saturday and 2026-11-01 a Sunday.
  const saturday = income('monthly', '2026-08-01', { weekendShift: true });
  assert.deepEqual(incomePaydays(saturday, '2026-07-01', '2026-09-30'), [
    { nominal: '2026-08-01', paid: '2026-07-31' }, { nominal: '2026-09-01', paid: '2026-09-01' },
  ]);
  assert.equal(inMonth(saturday, '2026-07'), 1, 'counted in the previous month');
  assert.equal(inMonth(saturday, '2026-08'), 0, 'and not in its own month');
  const sunday = income('monthly', '2026-01-01', { weekendShift: true });
  assert.deepEqual(incomePaydays(sunday, '2026-10-25', '2026-11-05'), [{ nominal: '2026-11-01', paid: '2026-10-30' }]);
  assert.equal(inMonth(sunday, '2026-10'), 2, 'October 1 (a Thursday) and the shifted November 1');
  assert.equal(inMonth(sunday, '2026-11'), 0);
  // Monday to Friday paydays do not move, and weekly pay on a weekend moves every week.
  assert.deepEqual(paidIn(income('monthly', '2026-09-01', { weekendShift: true }), '2026-09-01', '2026-09-30'), ['2026-09-01']);
  assert.deepEqual(paidIn(income('weekly', '2026-01-03', { weekendShift: true }), '2026-01-01', '2026-01-31'), ['2026-01-02', '2026-01-09', '2026-01-16', '2026-01-23', '2026-01-30']);
  assert.deepEqual(paidIn(income('weekly', '2026-01-04', { weekendShift: true, interval: 2 }), '2026-01-01', '2026-02-28'), ['2026-01-02', '2026-01-16', '2026-01-30', '2026-02-13', '2026-02-27']);
});

test('start and end dates apply to the nominal payday, not the shifted one', () => {
  // The first payday is Saturday 2026-08-01 and is paid before the start date.
  assert.equal(countIncomeOccurrences(income('monthly', '2026-08-01', { weekendShift: true }), '2026-07-31', '2026-07-31'), 1);
  // A nominal payday on the end date still pays (on Friday).
  const endsSaturday = income('monthly', '2026-01-01', { weekendShift: true, endDate: '2026-08-01' });
  assert.deepEqual(paidIn(endsSaturday, '2026-07-01', '2026-07-31'), ['2026-07-01', '2026-07-31']);
  // A nominal payday after the end date pays nothing even when its Friday is before the end date.
  const endsFriday = income('monthly', '2026-01-01', { weekendShift: true, endDate: '2026-07-31' });
  assert.deepEqual(paidIn(endsFriday, '2026-07-01', '2026-07-31'), ['2026-07-01']);
  // Nothing before the start and nothing at all for an empty range.
  assert.equal(countIncomeOccurrences(income('monthly', '2026-08-01', { weekendShift: true }), '2026-06-01', '2026-07-30'), 0);
  assert.equal(countIncomeOccurrences(income('monthly', '2026-08-01', { weekendShift: true }), '2026-07-31', '2026-07-30'), 0);
});

test('unbounded generation ignores start and end dates, real totals never do', () => {
  const pay = income('weekly', '2026-02-06', { interval: 2, endDate: '2026-03-06' });
  assert.deepEqual(paidIn(pay, '2026-01-01', '2026-04-30'), ['2026-02-06', '2026-02-20', '2026-03-06']);
  const open = incomePaydays(pay, '2026-01-01', '2026-04-30', { unbounded: true }).map(payday => payday.paid);
  assert.deepEqual(open, ['2026-01-09', '2026-01-23', '2026-02-06', '2026-02-20', '2026-03-06', '2026-03-20', '2026-04-03', '2026-04-17']);
  assert.equal(inMonth(pay, '2026-01'), 0);
  assert.equal(getMonthIncome('2026-04', [pay]).totalIncome, 0);
  const monthly = income('monthly', '2026-06-25', { endDate: '2026-08-25' });
  assert.deepEqual(incomePaydays(monthly, '2026-04-01', '2026-10-31', { unbounded: true }).map(payday => payday.paid),
    ['2026-04-25', '2026-05-25', '2026-06-25', '2026-07-25', '2026-08-25', '2026-09-25', '2026-10-25']);
});

test('describeIncomeSchedule keeps old texts and names the new options', () => {
  assert.equal(describeIncomeSchedule(income('monthly', '2026-01-05')), 'Monthly · from 2026-01-05');
  assert.equal(describeIncomeSchedule(income('weekly', '2026-01-05', { endDate: '2026-12-31' })), 'Weekly · 2026-01-05 to 2026-12-31');
  assert.equal(describeIncomeSchedule(income('once', '2026-01-05')), 'One time on 2026-01-05');
  assert.equal(describeIncomeSchedule(income('weekly', '2026-01-05', { interval: 2 })), 'Every 2 weeks · from 2026-01-05');
  assert.equal(describeIncomeSchedule(income('semimonthly', '2026-01-05', { semimonthlyDays: [15, 31], weekendShift: true })), 'Twice a month (15 and 31), Friday if weekend · from 2026-01-05');
});
