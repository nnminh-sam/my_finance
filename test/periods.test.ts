import assert from 'node:assert/strict';
import test from 'node:test';
import { monthRange } from '../src/lib/income';
import { periodOf, periodsBetween, type BudgetPeriodSetting, type PeriodIncome } from '../src/lib/periods';
import { addDays, MAX_RANGE_DAYS } from '../src/lib/plans';

function pay(id: string, frequency: PeriodIncome['frequency'], startDate: string, extra: Partial<PeriodIncome> = {}): PeriodIncome {
  return { id, frequency, startDate, endDate: null, ...extra };
}
const calendar: BudgetPeriodSetting = { mode: 'calendar', startDay: 1, paycheckIncomeId: null };
const fromDay = (startDay: number): BudgetPeriodSetting => ({ mode: 'monthly_from_day', startDay, paycheckIncomeId: null });
const paycheck = (id: string): BudgetPeriodSetting => ({ mode: 'paycheck', startDay: 1, paycheckIncomeId: id });
const bounds = (period: { start: string; end: string }) => [period.start, period.end];

test('calendar periods equal monthRange for every day of several years', () => {
  for (let year = 2019; year <= 2032; year++) {
    for (let month = 1; month <= 12; month++) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const range = monthRange(key);
      for (const date of [range.start, `${key}-15`, range.end]) {
        const period = periodOf(calendar, [], date);
        assert.deepEqual(bounds(period), [range.start, range.end], date);
        assert.equal(period.nextStart, addDays(range.end, 1));
        assert.equal(period.mode, 'calendar');
      }
    }
  }
});

test('monthly from a start day: the start day begins a period and the day before ends one', () => {
  assert.deepEqual(bounds(periodOf(fromDay(25), [], '2026-11-24')), ['2026-10-25', '2026-11-24']);
  assert.deepEqual(bounds(periodOf(fromDay(25), [], '2026-11-25')), ['2026-11-25', '2026-12-24']);
  assert.deepEqual(bounds(periodOf(fromDay(25), [], '2027-01-10')), ['2026-12-25', '2027-01-24']);
  assert.deepEqual(bounds(periodOf(fromDay(25), [], '2026-12-31')), ['2026-12-25', '2027-01-24']);
  // Day 28 exists in every month, including February and leap years.
  assert.deepEqual(bounds(periodOf(fromDay(28), [], '2027-02-27')), ['2027-01-28', '2027-02-27']);
  assert.deepEqual(bounds(periodOf(fromDay(28), [], '2027-02-28')), ['2027-02-28', '2027-03-27']);
  assert.deepEqual(bounds(periodOf(fromDay(28), [], '2028-02-29')), ['2028-02-28', '2028-03-27']);
  assert.equal(periodOf(fromDay(25), [], '2026-11-25').mode, 'monthly_from_day');
  // Start day 1 is the calendar month.
  for (let day = 0; day < 800; day++) {
    const date = addDays('2023-01-01', day);
    assert.deepEqual(bounds(periodOf(fromDay(1), [], date)), bounds(periodOf(calendar, [], date)), date);
  }
});

test('paycheck mode on a monthly income extrapolates before the start and after the end', () => {
  const salary = pay('s', 'monthly', '2026-01-25', { endDate: '2026-06-25' });
  assert.deepEqual(bounds(periodOf(paycheck('s'), [salary], '2026-03-10')), ['2026-02-25', '2026-03-24']);
  assert.deepEqual(bounds(periodOf(paycheck('s'), [salary], '2025-12-10')), ['2025-11-25', '2025-12-24']);
  assert.deepEqual(bounds(periodOf(paycheck('s'), [salary], '2026-12-10')), ['2026-11-25', '2026-12-24']);
  const period = periodOf(paycheck('s'), [salary], '2026-03-25');
  assert.deepEqual([period.start, period.nextStart, period.mode], ['2026-03-25', '2026-04-25', 'paycheck']);
});

test('paycheck mode on weekly, 2-weekly, 4-weekly and twice-a-month incomes', () => {
  const weekly = pay('w', 'weekly', '2026-01-02');
  assert.deepEqual(bounds(periodOf(paycheck('w'), [weekly], '2026-03-04')), ['2026-02-27', '2026-03-05']);
  const biweekly = pay('b', 'weekly', '2026-01-02', { interval: 2 });
  assert.deepEqual(bounds(periodOf(paycheck('b'), [biweekly], '2026-03-04')), ['2026-02-27', '2026-03-12']);
  const fourWeekly = (start: string) => pay('f', 'weekly', start, { interval: 4 });
  // 13 paydays in 2026 when the first is Jan 2, 14 when it is Jan 1.
  for (const [start, count] of [['2026-01-02', 13], ['2026-01-01', 14]] as const) {
    const periods = periodsBetween(paycheck('f'), [fourWeekly(start)], '2026-01-01', '2026-12-31');
    assert.equal(periods.filter(period => period.start >= '2026-01-01').length, count, start);
    periods.forEach((period, index) => {
      assert.equal(period.end, addDays(period.nextStart, -1));
      if (index > 0) assert.equal(period.start, periods[index - 1].nextStart, 'contiguous');
    });
  }
  const twice = pay('t', 'semimonthly', '2026-01-01', { semimonthlyDays: [1, 16] });
  assert.deepEqual(bounds(periodOf(paycheck('t'), [twice], '2026-03-20')), ['2026-03-16', '2026-03-31']);
  assert.deepEqual(bounds(periodOf(paycheck('t'), [twice], '2026-02-10')), ['2026-02-01', '2026-02-15']);
});

test('shifted paydays start the period on the Friday and collisions give one boundary', () => {
  // 2026-08-01 is a Saturday, so the period starts Friday 2026-07-31.
  const shifted = pay('m', 'monthly', '2026-01-01', { weekendShift: true });
  assert.deepEqual(bounds(periodOf(paycheck('m'), [shifted], '2026-08-15')), ['2026-07-31', '2026-08-31']);
  assert.deepEqual(bounds(periodOf(paycheck('m'), [shifted], '2026-07-30')), ['2026-07-01', '2026-07-30']);
  // Saturday Aug 1 and Sunday Aug 2 both move onto Friday Jul 31: one boundary, no empty period.
  const collide = pay('c', 'semimonthly', '2026-01-01', { semimonthlyDays: [1, 2], weekendShift: true });
  const periods = periodsBetween(paycheck('c'), [collide], '2026-07-01', '2026-09-30');
  assert.ok(periods.every(period => period.start <= period.end));
  assert.equal(periods.filter(period => period.start === '2026-07-31').length, 1);
  assert.deepEqual(bounds(periodOf(paycheck('c'), [collide], '2026-08-02')), ['2026-07-31', '2026-08-31']);
});

test('paycheck mode falls back to calendar periods instead of failing', () => {
  const date = '2026-03-10';
  const expected = bounds(periodOf(calendar, [], date));
  const cases: [BudgetPeriodSetting, PeriodIncome[]][] = [
    [paycheck('missing'), []],
    [{ mode: 'paycheck', startDay: 1, paycheckIncomeId: null }, []],
    [paycheck('d'), [pay('d', 'daily', '2026-01-01')]],
    [paycheck('y'), [pay('y', 'yearly', '2026-01-01')]],
    [paycheck('o'), [pay('o', 'once', '2026-01-01')]],
  ];
  for (const [setting, incomes] of cases) {
    const period = periodOf(setting, incomes, date);
    assert.deepEqual(bounds(period), expected);
    assert.equal(period.mode, 'calendar');
  }
});

test('periodsBetween returns contiguous overlapping periods and caps the range', () => {
  const periods = periodsBetween(fromDay(25), [], '2026-11-30', '2027-02-10');
  assert.deepEqual(periods.map(bounds), [['2026-11-25', '2026-12-24'], ['2026-12-25', '2027-01-24'], ['2027-01-25', '2027-02-24']]);
  assert.deepEqual(periodsBetween(calendar, [], '2026-05-10', '2026-05-10').map(bounds), [['2026-05-01', '2026-05-31']]);
  assert.deepEqual(periodsBetween(calendar, [], '2026-05-10', '2026-05-09'), []);
  const from = '2020-01-01';
  assert.ok(periodsBetween(calendar, [], from, addDays(from, MAX_RANGE_DAYS)).length > 100);
  assert.throws(() => periodsBetween(calendar, [], from, addDays(from, MAX_RANGE_DAYS + 1)), RangeError);
});
