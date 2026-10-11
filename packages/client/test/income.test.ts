import assert from 'node:assert/strict';
import test from 'node:test';
import { getMonthIncome, incomeMonth } from '../src/income';
import type { IncomeEntry } from '../src/types';

function entry(id: string, month: string, amount: number): IncomeEntry {
  return { id, month, amount, description: id };
}

test('incomeMonth uses the selected local calendar month including its year', () => {
  assert.equal(incomeMonth(new Date(2020, 0, 1, 0)), '2020-01');
  assert.equal(incomeMonth(new Date(2020, 11, 31, 23, 59)), '2020-12');
  assert.equal(incomeMonth(new Date(2021, 0, 1, 0)), '2021-01');
});

test('empty or nonmatching entries retain only recurring base income', () => {
  for (const entries of [[], [entry('other-month', '2020-02', 500)]]) {
    assert.deepEqual(getMonthIncome(1000, '2020-01', entries), {
      baseIncome: 1000, additionalIncome: 0, totalIncome: 1000, entries: [],
    });
  }
  assert.deepEqual(getMonthIncome(0, '2020-01', []), {
    baseIncome: 0, additionalIncome: 0, totalIncome: 0, entries: [],
  });
});

test('additional income alone supplies the selected month with a zero base', () => {
  const extra = entry('bonus', '2020-01', 250);
  assert.deepEqual(getMonthIncome(0, '2020-01', [extra]), {
    baseIncome: 0, additionalIncome: 250, totalIncome: 250, entries: [extra],
  });
});

test('multiple entries apply only to their exact month and year without mutating inputs', () => {
  const january = Object.freeze(entry('january', '2020-01', 200));
  const bonus = Object.freeze(entry('bonus', '2020-01', 50));
  const february = Object.freeze(entry('february', '2020-02', 300));
  const otherYear = Object.freeze(entry('other-year', '2021-01', 400));
  const entries = Object.freeze([february, january, otherYear, bonus]);
  const before = entries.map(value => ({ ...value }));
  assert.deepEqual(getMonthIncome(1000, '2020-01', entries), {
    baseIncome: 1000, additionalIncome: 250, totalIncome: 1250, entries: [january, bonus],
  });
  assert.deepEqual(getMonthIncome(1000, '2020-02', entries), {
    baseIncome: 1000, additionalIncome: 300, totalIncome: 1300, entries: [february],
  });
  assert.deepEqual(getMonthIncome(1000, '2021-01', entries), {
    baseIncome: 1000, additionalIncome: 400, totalIncome: 1400, entries: [otherYear],
  });
  assert.deepEqual(entries, before);
});

test('income sums controlled cents exactly including 0.1 + 0.2 = 0.3', () => {
  const entries = [entry('first', '2020-01', 0.1), entry('second', '2020-01', 0.2)];
  assert.equal(getMonthIncome(0, '2020-01', entries).additionalIncome, 0.3);
  assert.equal(getMonthIncome(0, '2020-01', entries).totalIncome, 0.3);
  assert.equal(getMonthIncome(0.1, '2020-01', [entries[1]]).totalIncome, 0.3);
  assert.deepEqual(getMonthIncome(10.01, '2020-01', entries), {
    baseIncome: 10.01, additionalIncome: 0.3, totalIncome: 10.31, entries,
  });
});

test('editing amounts, moving months, and deleting entries recalculate without stale totals', () => {
  const original = [entry('bonus', '2020-01', 100), entry('gift', '2020-01', 50)];
  assert.equal(getMonthIncome(1000, '2020-01', original).totalIncome, 1150);
  const edited = original.map(value => value.id === 'bonus' ? { ...value, amount: 200 } : value);
  assert.equal(getMonthIncome(1000, '2020-01', edited).totalIncome, 1250);
  const moved = edited.map(value => value.id === 'bonus' ? { ...value, month: '2020-02' } : value);
  assert.equal(getMonthIncome(1000, '2020-01', moved).totalIncome, 1050);
  assert.equal(getMonthIncome(1000, '2020-02', moved).totalIncome, 1200);
  const deleted = moved.filter(value => value.id !== 'gift');
  assert.equal(getMonthIncome(1000, '2020-01', deleted).totalIncome, 1000);
  assert.equal(getMonthIncome(1000, '2020-01', original).totalIncome, 1150);
});

test('historical and future selected months use their own extras with a stable recurring base', () => {
  const entries = [entry('history', '2000-12', 20), entry('future', '2100-01', 30)];
  for (const [date, additionalIncome] of [
    [new Date(2000, 11, 15, 12), 20],
    [new Date(2100, 0, 15, 12), 30],
    [new Date(2100, 1, 15, 12), 0],
  ] as const) {
    const result = getMonthIncome(1000, incomeMonth(date), entries);
    assert.equal(result.baseIncome, 1000);
    assert.equal(result.additionalIncome, additionalIncome);
    assert.equal(result.totalIncome, 1000 + additionalIncome);
  }
});
