import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDayItems,
  dayNet,
  dayTiles,
  dayTone,
  formatSigned,
  formatSignedShort,
  partsOf,
  transactionCount,
  type DayItem,
} from '../src/lib/calendarDay';
import type { Spending } from '../src/types';

const MINUS = '−';
const NONE = { spent: 0, received: 0, planned: 0, expected: 0 };
const spending = (id: string, amount: number, time = '09:00', description = ''): Spending =>
  ({ id, amount, description, category: 'food', date: '2026-11-18', time });
const names = (id: string) => (id === 'food' ? 'Food' : id);
const items = (over: Partial<Parameters<typeof buildDayItems>[0]> = {}): DayItem[] =>
  buildDayItems({ spendings: [], received: [], expected: [], planned: [], categoryName: names, ...over });

test('a spend-only day nets negative and reads plain', () => {
  const day = dayNet({ ...NONE, spent: 85_000 });
  assert.equal(day.net, -85_000);
  assert.equal(day.hasActual, true);
  assert.equal(dayTone(day, false), 'out');
  assert.equal(formatSigned(day.net), `${MINUS}85.000`);
});

test('an income-only day nets positive and reads jade', () => {
  const day = dayNet({ ...NONE, received: 25_000_000 });
  assert.equal(day.net, 25_000_000);
  assert.equal(dayTone(day, false), 'in');
  assert.equal(formatSigned(day.net), '+25.000.000');
});

test('a planned-only day reads forecast grey, whichever way the money goes', () => {
  const out = dayNet({ ...NONE, planned: 500_000 });
  assert.equal(dayTone(out, false), 'plan');
  assert.equal(formatSigned(out.net), `${MINUS}500.000`);
  const inbound = dayNet({ ...NONE, expected: 20_000_000 });
  assert.equal(dayTone(inbound, false), 'plan');
  assert.equal(formatSigned(inbound.net), '+20.000.000');
});

test('a mixed day sums received, expected, spent and planned', () => {
  const day = dayNet({ spent: 100_000, received: 300_000, planned: 50_000, expected: 10_000 });
  assert.equal(day.net, 160_000);
  assert.equal(day.hasActual && day.hasPlan, true);
  assert.equal(dayTone(day, false), 'in');
});

test('a day with nothing on it has no items and a zero net', () => {
  const day = dayNet(NONE);
  assert.equal(day.hasItems, false);
  assert.equal(day.net, 0);
  assert.equal(dayTone(day, false), 'zero');
  assert.equal(formatSigned(0), '0');
});

test('an over-budget day is amber unless money came in on net', () => {
  assert.equal(dayTone(dayNet({ ...NONE, spent: 900_000 }), true), 'over');
  assert.equal(dayTone(dayNet({ ...NONE, spent: 900_000, received: 2_000_000 }), true), 'in');
});

test('signs: + for gains, U+2212 for losses, nothing for zero or rounding to zero', () => {
  assert.equal(formatSigned(1)[0], '+');
  assert.equal(formatSigned(-1)[0], MINUS);
  assert.notEqual(formatSigned(-1)[0], '-');
  assert.equal(formatSigned(0.2), '0');
});

test('short form for narrow cells keeps the sign', () => {
  assert.equal(formatSignedShort(-1_500_000), `${MINUS}1,5tr`);
  assert.equal(formatSignedShort(25_000_000), '+25tr');
  assert.equal(formatSignedShort(-85_000), `${MINUS}85k`);
  assert.equal(formatSignedShort(-850), `${MINUS}850`);
  assert.equal(formatSignedShort(0), '0');
});

test('items list received first, then spent by time, then planned', () => {
  const list = items({
    spendings: [spending('b', 20_000, '18:00', 'Dinner'), spending('a', 10_000, '08:00')],
    received: [{ id: 'r', amount: 1_000_000, description: '', category: 'Freelance' }],
    expected: [{ incomeId: 'i', amount: 5_000_000, name: 'Salary', source: 'Salary', date: '2026-11-18' }],
    planned: [{ planId: 'p', amount: 300_000, description: 'Rent', category: 'bills' }],
  });
  assert.deepEqual(list.map(item => item.label), ['Freelance', 'Food', 'Dinner', 'Salary', 'Rent']);
  assert.deepEqual(list.map(item => item.kind), ['received', 'spent', 'spent', 'planned', 'planned']);
  assert.deepEqual(partsOf(list), { spent: 30_000, received: 1_000_000, planned: 300_000, expected: 5_000_000 });
});

test('tiles appear only when a day mixes two or more kinds', () => {
  assert.deepEqual(dayTiles(items({ spendings: [spending('a', 10_000)] }), false), []);
  const mixed = dayTiles(items({
    spendings: [spending('a', 10_000), spending('b', 20_000)],
    received: [{ id: 'r', amount: 1_000_000, description: 'Pay', category: 'Salary' }],
    planned: [{ planId: 'p', amount: 300_000, description: 'Rent', category: 'bills' }],
    expected: [{ incomeId: 'i', amount: 50_000, name: 'Gift', source: 'Gift', date: '2026-11-18' }],
  }), false);
  assert.deepEqual(mixed.map(tile => [tile.kind, tile.amount, tile.count, tile.tone]), [
    ['spent', -30_000, 2, 'out'],
    ['received', 1_000_000, 1, 'in'],
    ['planned', -250_000, 2, 'plan'],
  ]);
});

test('the spent tile turns amber on an over-budget day', () => {
  const tiles = dayTiles(items({
    spendings: [spending('a', 900_000)],
    received: [{ id: 'r', amount: 1_000, description: 'x', category: 'Gift' }],
  }), true);
  assert.equal(tiles[0].tone, 'over');
});

test('transaction count is singular for one and empty for none', () => {
  assert.equal(transactionCount(0), '');
  assert.equal(transactionCount(1), '1 transaction');
  assert.equal(transactionCount(3), '3 transactions');
});

test('short form rounds up into millions instead of showing 1.000k', () => {
  assert.equal(formatSignedShort(-999_600), `${MINUS}1tr`);
  assert.equal(formatSignedShort(999_400), '+999k');
});

test('an over-budget day whose net is exactly 0 stays amber on purpose', () => {
  const day = dayNet({ ...NONE, spent: 900_000, received: 900_000 });
  assert.equal(day.net, 0);
  assert.equal(dayTone(day, true), 'over');
  assert.equal(dayTone(day, false), 'zero');
});

test('expected income with planned spending is one planned kind, so no tiles', () => {
  const list = items({
    expected: [{ incomeId: 'i', amount: 5_000_000, name: 'Salary', source: 'Salary', date: '2026-11-18' }],
    planned: [{ planId: 'p', amount: 300_000, description: 'Rent', category: 'bills' }],
  });
  assert.deepEqual(dayTiles(list, false), []);
  const day = dayNet(partsOf(list));
  assert.equal(day.net, 4_700_000);
  assert.equal(dayTone(day, false), 'plan');
});
