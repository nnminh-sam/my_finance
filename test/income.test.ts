import assert from 'node:assert/strict';
import test from 'node:test';
import { countIncomeOccurrences, describeIncomeSchedule, getMonthIncome, incomeMonth, monthRange } from '../src/lib/income';
import type { Income, IncomeFrequency } from '../src/types';

function income(id: string, frequency: IncomeFrequency, amount: number, startDate: string, endDate: string | null = null): Income {
  return { id, source: 'Source', name: id, amount, frequency, startDate, endDate };
}

const inMonth = (value: Income, month: string) => {
  const { start, end } = monthRange(month);
  return countIncomeOccurrences(value, start, end);
};

test('incomeMonth and monthRange use the local calendar month including leap Februaries', () => {
  assert.equal(incomeMonth(new Date(2020, 0, 1, 0)), '2020-01');
  assert.equal(incomeMonth(new Date(2020, 11, 31, 23, 59)), '2020-12');
  assert.deepEqual(monthRange('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(monthRange('2023-02'), { start: '2023-02-01', end: '2023-02-28' });
  assert.deepEqual(monthRange('2026-10'), { start: '2026-10-01', end: '2026-10-31' });
});

test('one-time income counts only in the month of its date', () => {
  const gift = income('gift', 'once', 500, '2026-10-15');
  assert.equal(inMonth(gift, '2026-10'), 1);
  assert.equal(inMonth(gift, '2026-09'), 0);
  assert.equal(inMonth(gift, '2026-11'), 0);
  assert.equal(countIncomeOccurrences(gift, '2026-10-16', '2026-10-31'), 0);
  assert.equal(countIncomeOccurrences(gift, '2026-10-15', '2026-10-15'), 1);
});

test('daily income counts every day from its start through its end date', () => {
  const allowance = income('allowance', 'daily', 50, '2026-10-10');
  assert.equal(inMonth(allowance, '2026-09'), 0);
  assert.equal(inMonth(allowance, '2026-10'), 22);
  assert.equal(inMonth(allowance, '2026-11'), 30);
  assert.equal(inMonth(allowance, '2024-02'), 0);
  assert.equal(inMonth(income('leap', 'daily', 1, '2024-01-01'), '2024-02'), 29);
  assert.equal(inMonth(income('ended', 'daily', 1, '2026-10-10', '2026-11-05'), '2026-11'), 5);
  assert.equal(inMonth(income('ended', 'daily', 1, '2026-10-10', '2026-11-05'), '2026-12'), 0);
});

test('weekly income repeats on the start date weekday', () => {
  // 2026-10-05 is a Monday. October 2026 Mondays: 5, 12, 19, 26. November: 2, 9, 16, 23, 30.
  const wage = income('wage', 'weekly', 1_000_000, '2026-10-05');
  assert.equal(inMonth(wage, '2026-10'), 4);
  assert.equal(inMonth(wage, '2026-11'), 5);
  assert.equal(inMonth(wage, '2026-09'), 0);
  assert.equal(countIncomeOccurrences(wage, '2026-10-06', '2026-10-11'), 0);
  assert.equal(countIncomeOccurrences(wage, '2026-10-06', '2026-10-12'), 1);
  assert.equal(inMonth(income('until', 'weekly', 1, '2026-10-05', '2026-11-15'), '2026-11'), 2);
  // Starting mid-month: Thursday 2026-10-29 only pays once in October.
  assert.equal(inMonth(income('late', 'weekly', 1, '2026-10-29'), '2026-10'), 1);
});

test('monthly income pays on the start day, clamped to shorter months, within its end date', () => {
  const salary = income('salary', 'monthly', 20_000_000, '2026-01-31');
  assert.equal(inMonth(salary, '2025-12'), 0);
  assert.equal(inMonth(salary, '2026-01'), 1);
  assert.equal(inMonth(salary, '2026-02'), 1, 'Feb 28 replaces the 31st');
  assert.equal(inMonth(salary, '2026-04'), 1, 'Apr 30 replaces the 31st');
  assert.equal(inMonth(salary, '2030-07'), 1);
  const contract = income('contract', 'monthly', 1, '2026-01-15', '2026-03-14');
  assert.equal(inMonth(contract, '2026-02'), 1);
  assert.equal(inMonth(contract, '2026-03'), 0, 'March 15 is after the end date');
  assert.equal(countIncomeOccurrences(salary, '2026-01-01', '2026-12-31'), 12);
});

test('yearly income pays once a year in the start month, with Feb 29 moving to Feb 28 in common years', () => {
  const dividend = income('dividend', 'yearly', 3_000_000, '2024-02-29');
  assert.equal(inMonth(dividend, '2024-02'), 1);
  assert.equal(inMonth(dividend, '2025-02'), 1);
  assert.equal(inMonth(dividend, '2025-03'), 0);
  assert.equal(inMonth(dividend, '2023-02'), 0, 'before the start date');
  assert.equal(countIncomeOccurrences(dividend, '2024-01-01', '2027-12-31'), 4);
  assert.equal(inMonth(income('ended', 'yearly', 1, '2024-06-01', '2025-05-31'), '2025-06'), 0);
});

test('getMonthIncome sums every source in exact cents and splits recurring from one-time income', () => {
  const salary = income('salary', 'monthly', 20_000_000, '2026-01-05');
  const wage = income('wage', 'weekly', 0.1, '2026-10-05');
  const gift = income('gift', 'once', 0.2, '2026-10-20');
  const other = income('other', 'once', 900, '2026-11-01');
  const incomes = Object.freeze([salary, wage, gift, other].map(value => Object.freeze(value)));
  const result = getMonthIncome('2026-10', incomes);
  assert.equal(result.recurringIncome, 20_000_000.4);
  assert.equal(result.oneTimeIncome, 0.2);
  assert.equal(result.totalIncome, 20_000_000.6);
  assert.deepEqual(result.items, [
    { income: salary, occurrences: 1, total: 20_000_000 },
    { income: wage, occurrences: 4, total: 0.4 },
    { income: gift, occurrences: 1, total: 0.2 },
  ]);
  assert.deepEqual(getMonthIncome('2025-01', incomes), { recurringIncome: 0, oneTimeIncome: 0, totalIncome: 0, items: [] });
  assert.deepEqual(getMonthIncome('2026-10', []), { recurringIncome: 0, oneTimeIncome: 0, totalIncome: 0, items: [] });
});

test('editing, ending, and deleting income recalculate months without stale totals', () => {
  const original = [income('salary', 'monthly', 1000, '2026-01-01'), income('bonus', 'once', 500, '2026-10-01')];
  assert.equal(getMonthIncome('2026-10', original).totalIncome, 1500);
  const edited = original.map(value => value.id === 'salary' ? { ...value, amount: 1200 } : value);
  assert.equal(getMonthIncome('2026-10', edited).totalIncome, 1700);
  const ended = edited.map(value => value.id === 'salary' ? { ...value, endDate: '2026-09-30' } : value);
  assert.equal(getMonthIncome('2026-10', ended).totalIncome, 500);
  assert.equal(getMonthIncome('2026-09', ended).totalIncome, 1200);
  assert.equal(getMonthIncome('2026-10', ended.filter(value => value.id !== 'bonus')).totalIncome, 0);
  assert.equal(getMonthIncome('2026-10', original).totalIncome, 1500);
});

test('describeIncomeSchedule summarizes frequency and period', () => {
  assert.equal(describeIncomeSchedule(income('a', 'once', 1, '2026-10-01')), 'One time on 2026-10-01');
  assert.equal(describeIncomeSchedule(income('b', 'weekly', 1, '2026-10-05')), 'Weekly · from 2026-10-05');
  assert.equal(describeIncomeSchedule(income('c', 'monthly', 1, '2026-01-05', '2026-12-31')), 'Monthly · 2026-01-05 to 2026-12-31');
});
