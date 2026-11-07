import assert from 'node:assert/strict';
import test from 'node:test';
import { getMonthIncome, monthRange } from '../src/lib/income';
import {
  adjacentPeriod, adjacentPeriodDate, DEFAULT_SHOW_BY, markerSets, periodDayLabel, periodOf, periodRangeLabel, periodsBetween, SHOW_BY, viewPeriodIncome, viewPeriodOf,
  type BudgetPeriodSetting, type PeriodIncome,
} from '../src/lib/periods';
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

test('viewPeriodOf: pay cycle follows the saved setting, calendar month ignores it', () => {
  assert.deepEqual(bounds(viewPeriodOf(fromDay(25), 'pay_cycle', [], '2026-11-30')), ['2026-11-25', '2026-12-24']);
  assert.deepEqual(bounds(viewPeriodOf(fromDay(25), 'calendar_month', [], '2026-11-30')), ['2026-11-01', '2026-11-30']);
  const calendarOfDefault = viewPeriodOf(calendar, 'pay_cycle', [], '2026-11-30');
  assert.deepEqual(bounds(calendarOfDefault), ['2026-11-01', '2026-11-30']);
  assert.equal(calendarOfDefault.mode, 'calendar');
  // A deleted paycheck income falls back to the calendar month and reports it.
  assert.equal(viewPeriodOf(paycheck('gone'), 'pay_cycle', [], '2026-11-10').mode, 'calendar');
  const salary = pay('s', 'monthly', '2026-01-25');
  assert.equal(viewPeriodOf(paycheck('s'), 'pay_cycle', [salary], '2026-11-30').mode, 'paycheck');
  assert.equal(DEFAULT_SHOW_BY, 'calendar_month');
  assert.deepEqual([...SHOW_BY], ['calendar_month', 'pay_cycle']);
});

test('adjacentPeriod: previous of next is the original in every mode and across February', () => {
  const salary = pay('s', 'monthly', '2026-01-25');
  const settings: [BudgetPeriodSetting, PeriodIncome[]][] = [[calendar, []], [fromDay(25), []], [fromDay(28), []], [paycheck('s'), [salary]]];
  for (const [setting, incomes] of settings) {
    const resolve = (date: string) => periodOf(setting, incomes, date);
    for (const date of ['2026-02-14', '2026-03-01', '2026-11-25', '2027-01-03', '2028-02-29']) {
      const period = resolve(date);
      const next = adjacentPeriod(resolve, period, 'next');
      const previous = adjacentPeriod(resolve, period, 'previous');
      assert.equal(next.start, period.nextStart);
      assert.equal(previous.nextStart, period.start);
      assert.deepEqual(adjacentPeriod(resolve, next, 'previous'), period);
      assert.deepEqual(adjacentPeriod(resolve, previous, 'next'), period);
    }
  }
  assert.equal(adjacentPeriodDate({ start: '2026-11-25', nextStart: '2026-12-25' }, 'previous'), '2026-11-24');
  assert.equal(adjacentPeriodDate({ start: '2026-11-25', nextStart: '2026-12-25' }, 'next'), '2026-12-25');
});

test('markerSets: one start and end per overlapping period, nothing in calendar mode', () => {
  const marks = markerSets(fromDay(25), [], '2026-11-01', '2027-01-10');
  assert.deepEqual([...marks.starts].sort(), ['2026-10-25', '2026-11-25', '2026-12-25']);
  assert.deepEqual([...marks.ends].sort(), ['2026-11-24', '2026-12-24', '2027-01-24']);
  assert.ok(!marks.starts.has('2026-11-26') && !marks.ends.has('2026-11-26'), 'a day inside a period is in neither set');
  const none = markerSets(calendar, [], '2026-11-01', '2027-01-10');
  assert.equal(none.starts.size + none.ends.size, 0);
  const salary = pay('s', 'weekly', '2026-01-02');
  const weekly = markerSets(paycheck('s'), [salary], '2026-03-01', '2026-03-14');
  assert.ok(weekly.starts.has('2026-03-06') && weekly.ends.has('2026-03-12'));
  // A paycheck setting that fell back to calendar has no markers either.
  const fallback = markerSets(paycheck('gone'), [], '2026-03-01', '2026-03-31');
  assert.equal(fallback.starts.size + fallback.ends.size, 0);
  assert.equal(markerSets(fromDay(25), [], '2026-05-10', '2026-05-09').starts.size, 0);
});

test('viewPeriodIncome: calendar month equals the old month income, pay cycle covers the period', () => {
  const salary = { id: 's', source: 'Salary', name: '', amount: 1000, frequency: 'monthly' as const, startDate: '2026-01-25', endDate: null };
  for (const month of ['2026-02', '2026-03', '2026-10']) {
    assert.deepEqual(viewPeriodIncome(fromDay(25), 'calendar_month', [salary], `${month}-17`), getMonthIncome(month, [salary]));
  }
  // The 25th..24th period holds exactly one payday, as does every calendar month.
  assert.equal(viewPeriodIncome(fromDay(25), 'pay_cycle', [salary], '2026-03-30').totalIncome, 1000);
  const once = { ...salary, id: 'o', frequency: 'once' as const, startDate: '2026-03-26' };
  assert.equal(viewPeriodIncome(fromDay(25), 'pay_cycle', [once], '2026-03-30').totalIncome, 1000);
  assert.equal(viewPeriodIncome(fromDay(25), 'pay_cycle', [once], '2026-04-30').totalIncome, 0);
});

test('markerSets walks a window longer than the range cap in chunks and never throws', () => {
  const from = '2000-01-01';
  const to = addDays(from, MAX_RANGE_DAYS * 2 + 50);
  const marks = markerSets(fromDay(25), [], from, to);
  assert.ok(marks.starts.has('2000-01-25') && marks.starts.has(addDays('2000-01-25', 0)));
  const last = periodOf(fromDay(25), [], to);
  assert.ok(marks.starts.has(last.start) && marks.ends.has(last.end), 'the last period of the window is marked');
  assert.ok(marks.starts.size > 200);
  assert.equal(markerSets(calendar, [], from, to).starts.size, 0);
});

test('period range labels are day-first and independent of the runtime locale', () => {
  const range = { start: '2026-11-25', end: '2026-12-24' };
  assert.equal(periodDayLabel('2026-01-05'), '5 Jan');
  assert.equal(periodRangeLabel(range), '25 Nov – 24 Dec');
  assert.equal(periodRangeLabel(range, true), '25 Nov – 24 Dec 2026');
  assert.equal(periodRangeLabel({ start: '2026-12-25', end: '2027-01-24' }, true), '25 Dec – 24 Jan 2027');
});
