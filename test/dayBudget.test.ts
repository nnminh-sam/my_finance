import assert from 'node:assert/strict';
import test from 'node:test';
import { dayFlag, everydayBudget, isBill, periodBills, splitDay } from '../src/lib/dayBudget';

// The 5 Nov – 4 Dec 2026 pay cycle the mockup was built from.
const SURE = { surePlanIds: new Set(['rent', 'mom', 'claude']), billCategories: new Set<string>() };
const BY_CATEGORY = { surePlanIds: new Set<string>(), billCategories: new Set(['Bills', 'For parents', 'Subscription']) };
const INCOME = 13_822_583;

test('a spending is a bill only when it came from a sure plan', () => {
  assert.equal(isBill({ planId: 'rent' }, SURE), true);
  assert.equal(isBill({ planId: 'lunch' }, SURE), false);
  assert.equal(isBill({ planId: null }, SURE), false);
  assert.equal(isBill({}, SURE), false);
});

test('a spending in a bill category is a bill without any plan', () => {
  assert.equal(isBill({ category: 'Bills' }, BY_CATEGORY), true);
  assert.equal(isBill({ category: 'For parents', planId: null }, BY_CATEGORY), true);
  assert.equal(isBill({ category: 'Breakfast' }, BY_CATEGORY), false);
});

test('bill categories set the budget for hand-typed rent and money for parents', () => {
  const spendings = [
    { amount: 3_000_000, date: '2026-11-07', category: 'Bills' },
    { amount: 3_000_000, date: '2026-11-07', category: 'For parents' },
    { amount: 555_000, date: '2026-11-07', category: 'Subscription' },
    { amount: 449_000, date: '2026-11-08', category: 'Shopping' },
  ];
  const upcoming = [{ amount: 80_000, sure: false, category: 'Gas' }, { amount: 200_000, sure: false, category: 'Bills' }];
  const bills = periodBills(spendings, upcoming, BY_CATEGORY);
  assert.equal(bills, 6_755_000);
  const budget = everydayBudget(INCOME, bills, 30);
  assert.equal(dayFlag(splitDay(spendings.slice(0, 3), BY_CATEGORY), budget), 'bills');
  assert.equal(dayFlag(splitDay(spendings.slice(3), BY_CATEGORY), budget), 'over');
});

test('period bills add sure spendings already made and sure occurrences still to come', () => {
  const spendings = [
    { amount: 3_000_000, date: '2026-11-07', planId: 'rent' },
    { amount: 3_000_000, date: '2026-11-07', planId: 'mom' },
    { amount: 239_000, date: '2026-11-12' },
    { amount: 15_000, date: '2026-11-10', planId: 'breakfast' },
  ];
  const upcoming = [{ amount: 555_000, sure: true }, { amount: 35_000, sure: false }];
  assert.equal(periodBills(spendings, upcoming, SURE), 6_555_000);
});

test('everyday budget is income less bills spread over the period', () => {
  assert.equal(everydayBudget(INCOME, 6_555_000, 30), 242_252.76);
  assert.equal(everydayBudget(0, 0, 30), null);
  assert.equal(everydayBudget(INCOME, 0, 0), null);
  assert.equal(everydayBudget(1_000_000, 1_000_000, 30), null);
  assert.equal(everydayBudget(1_000_000, 2_000_000, 30), null);
});

test('a day splits into bills and everyday spending', () => {
  assert.deepEqual(splitDay([
    { amount: 3_000_000, date: '2026-11-07', planId: 'rent' },
    { amount: 555_000, date: '2026-11-07', planId: 'claude' },
    { amount: 20_000, date: '2026-11-07' },
  ], SURE), { everyday: 20_000, bills: 3_555_000 });
  assert.deepEqual(splitDay([], SURE), { everyday: 0, bills: 0 });
});

test('days over the budget are flagged, bill-only days are tagged, the rest stay plain', () => {
  const budget = 242_252.76;
  assert.equal(dayFlag({ everyday: 449_000, bills: 0 }, budget), 'over');
  assert.equal(dayFlag({ everyday: 13_000, bills: 0 }, budget), null);
  assert.equal(dayFlag({ everyday: budget, bills: 0 }, budget), null);
  assert.equal(dayFlag({ everyday: 0, bills: 6_555_000 }, budget), 'bills');
  assert.equal(dayFlag({ everyday: 20_000, bills: 3_000_000 }, budget), null);
  assert.equal(dayFlag({ everyday: 0, bills: 0 }, budget), null);
});

test('without a budget nothing is flagged over', () => {
  assert.equal(dayFlag({ everyday: 5_000_000, bills: 0 }, null), null);
  assert.equal(dayFlag({ everyday: 0, bills: 100 }, null), 'bills');
});
