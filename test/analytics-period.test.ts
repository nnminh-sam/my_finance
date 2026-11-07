import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisPeriodFor, computeMonthlyAnalytics, stepAnalysisDate } from '../src/lib/analytics';
import { monthRange } from '../src/lib/income';
import { addDays } from '../src/lib/plans';
import type { BudgetPeriodSetting } from '../src/lib/periods';
import type { Income, Spending } from '../src/types';

const categories = [{ id: 'food', name: 'Food', color: '#123456', icon: 'Utensils' }];
const salary: Income = { id: 'salary', source: 'Salary', name: '', amount: 1000, frequency: 'monthly', startDate: '2020-01-25', endDate: null };
const calendar: BudgetPeriodSetting = { mode: 'calendar', startDay: 1, paycheckIncomeId: null };
const fromDay25: BudgetPeriodSetting = { mode: 'monthly_from_day', startDay: 25, paycheckIncomeId: null };

function spendingsFor(from: string, days: number): Spending[] {
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(from, index);
    return { id: `s-${date}`, date, time: '12:00', amount: 10 + (index % 7), category: 'food', description: 'x' };
  });
}
const all = spendingsFor('2019-06-01', 800);

test('calendar month with an explicit period equals the month analysis (same output, date range filter)', () => {
  for (const month of ['2019-12', '2020-02', '2020-03', '2020-10']) {
    const { start, end } = monthRange(month);
    const [year, monthNumber] = month.split('-').map(Number);
    const monthDate = new Date(year, monthNumber - 1, 1);
    const byMonth = computeMonthlyAnalytics(monthDate, { categories }, all, [salary]);
    const byPeriod = computeMonthlyAnalytics(monthDate, { categories }, all, [salary], { start, end });
    assert.deepEqual(byPeriod, byMonth, month);
  }
});

test('a pay period analyses its own days, spending and income', () => {
  const period = { start: '2020-02-25', end: '2020-03-24' };
  const a = computeMonthlyAnalytics(new Date(2020, 2, 1), { categories }, all, [salary], period);
  assert.equal(a.daysInMonth, 29, 'Feb 25 to Mar 24 in a leap year is 29 days');
  assert.equal(a.periodStart, '2020-02-25');
  assert.equal(a.periodEnd, '2020-03-24');
  assert.equal(a.daily.length, 29);
  assert.equal(a.elapsedDays, 29, 'a finished period counts all its days');
  assert.equal(a.isFutureMonth, false);
  assert.equal(a.income, 1000, 'one payday (the 25th) falls inside');
  const expected = all.filter(item => item.date >= period.start && item.date <= period.end);
  assert.equal(a.total, expected.reduce((sum, item) => sum + item.amount, 0));
  assert.equal(a.txCount, expected.length);
  assert.ok(a.spendings.every(item => item.date >= period.start && item.date <= period.end));
});

test('the comparison uses the previous period given, or the same window a month earlier', () => {
  const period = { start: '2020-03-25', end: '2020-04-24', previous: { start: '2020-02-25', end: '2020-03-24' } };
  const a = computeMonthlyAnalytics(new Date(2020, 3, 1), { categories }, all, [salary], period);
  const prevFull = all.filter(item => item.date >= '2020-02-25' && item.date <= '2020-03-24').reduce((sum, item) => sum + item.amount, 0);
  assert.equal(a.prevFullTotal, prevFull);
  assert.equal(a.prevSamePeriodTotal, prevFull, 'a finished period compares against the whole previous period');
  const fallback = computeMonthlyAnalytics(new Date(2020, 3, 1), { categories }, all, [salary], { start: period.start, end: period.end });
  assert.ok(fallback.prevFullTotal > 0);
});

test('analysisPeriodFor keeps the month path for calendar month and calendar-mode periods', () => {
  assert.equal(analysisPeriodFor(fromDay25, 'calendar_month', [], '2020-03-10'), undefined);
  assert.equal(analysisPeriodFor(calendar, 'pay_cycle', [], '2020-03-10'), undefined);
  assert.deepEqual(analysisPeriodFor(fromDay25, 'pay_cycle', [], '2020-03-10'), {
    start: '2020-02-25', end: '2020-03-24', previous: { start: '2020-01-25', end: '2020-02-24' },
  });
});

test('stepAnalysisDate walks pay periods and defers to months for calendar periods', () => {
  assert.equal(stepAnalysisDate(fromDay25, 'pay_cycle', [], '2020-03-10', 'next'), '2020-03-25');
  assert.equal(stepAnalysisDate(fromDay25, 'pay_cycle', [], '2020-03-10', 'previous'), '2020-01-25');
  assert.equal(stepAnalysisDate(fromDay25, 'calendar_month', [], '2020-03-10', 'next'), null);
  assert.equal(stepAnalysisDate(calendar, 'pay_cycle', [], '2020-03-10', 'next'), null);
});
