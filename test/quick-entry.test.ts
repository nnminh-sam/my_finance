import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createQuickEntry, dayLabel, entryFromSpending, incomeSummary, nextQuickEntry, prepareEntries, prepareEntry,
  pressKey, repeatSummary, saveEntries,
} from '../src/lib/quickEntry';
import type { PreparedEntry, QuickEntry } from '../src/lib/quickEntry';

const categories = [
  { id: 'food', name: 'Breakfast & Lunch', color: '#eab308', icon: 'Utensils' },
  { id: 'gas', name: 'Gas', color: '#3b82f6', icon: 'Car' },
];
const NOW = new Date(2026, 10, 4, 8, 30);
const base = (overrides: Partial<QuickEntry> = {}): QuickEntry => ({
  ...createQuickEntry(categories, '2026-11-04', NOW),
  amount: '45000',
  ...overrides,
});

test('keypad keys build whole-đồng amounts, drop leading zeros and cap at 12 digits', () => {
  let digits = '';
  for (const key of ['0', '4', '5', '000']) digits = pressKey(digits, key);
  assert.equal(digits, '45000');
  assert.equal(pressKey(digits, 'del'), '4500');
  assert.equal(pressKey('', 'del'), '');
  assert.equal(pressKey('', '000'), '');
  assert.equal(pressKey('999999999999', '1'), '999999999999');
  assert.equal(pressKey('45', 'x'), '45');
});

test('a new entry defaults to the first category, the given day, now and no repeat', () => {
  const entry = createQuickEntry(categories, '2026-11-04', NOW);
  assert.equal(entry.mode, 'spending');
  assert.equal(entry.category, 'food');
  assert.equal(entry.time, '08:30');
  assert.equal(entry.repeat.on, false);
  assert.deepEqual(entry.repeat.daysOfWeek, [3]); // 4 Nov 2026 is a Wednesday (JS day 3)
  assert.equal(entry.income.startDate, '2026-11-04');
});

test('a plain spending uses the category name when the description is blank', () => {
  const prepared = prepareEntry(base(), categories);
  assert.deepEqual(prepared, {
    kind: 'spending',
    input: { amount: 45000, description: 'Breakfast & Lunch', category: 'food', date: '2026-11-04', time: '08:30' },
  });
  assert.equal((prepareEntry(base({ description: '  Phở bò ' }), categories) as Extract<PreparedEntry, { kind: 'spending' }>).input.description, 'Phở bò');
});

test('zero amounts and unknown categories are rejected with the full form’s messages', () => {
  assert.throws(() => prepareEntry(base({ amount: '' }), categories), /positive amount/);
  assert.throws(() => prepareEntry(base({ category: 'nope' }), categories), /available category/);
});

test('repeat entries become repeat rules, with weekly days sorted and required', () => {
  const weekly = base({ repeat: { on: true, frequency: 'weekly', interval: 1, daysOfWeek: [5, 1], endType: 'occurrences', count: 4, endDate: '' } });
  const prepared = prepareEntry(weekly, categories);
  assert.equal(prepared.kind, 'repeat');
  assert.deepEqual(prepared.input, {
    amount: 45000, description: 'Breakfast & Lunch', category: 'food', startDate: '2026-11-04', time: '08:30',
    frequency: 'weekly', interval: 1, daysOfWeek: [1, 5], endType: 'occurrences', totalOccurrences: 4, endDate: undefined,
  });
  assert.throws(() => prepareEntry(base({ repeat: { ...weekly.repeat, daysOfWeek: [] } }), categories), /at least one day/);
  assert.throws(
    () => prepareEntry(base({ repeat: { ...weekly.repeat, frequency: 'daily', endType: 'until_date', endDate: '2026-11-01' } }), categories),
    /earlier than start/,
  );
});

test('income entries validate source, frequency and dates; one-time income has no end date', () => {
  const income = base({ mode: 'income', amount: '25000000', income: { source: 'Salary', name: 'Rikkei', frequency: 'once', startDate: '2026-11-10', endDate: '2026-12-01' } });
  assert.deepEqual(prepareEntry(income, categories), {
    kind: 'income',
    input: { source: 'Salary', name: 'Rikkei', amount: 25000000, frequency: 'once', startDate: '2026-11-10', endDate: null },
  });
  assert.throws(() => prepareEntry({ ...income, income: { ...income.income, frequency: 'monthly', endDate: '2026-11-01' } }, categories), /before the start date/);
});

test('batch errors name the failing entry; a single entry keeps the plain message', () => {
  assert.throws(() => prepareEntries([base(), base({ amount: '' })], categories), /^Error: Entry 2: Enter a positive amount/);
  assert.throws(() => prepareEntries([base({ amount: '' })], categories), /^Error: Enter a positive amount/);
});

test('saving stops at the first failure and returns the rest so a retry never duplicates', async () => {
  const items = prepareEntries([
    base(),
    base({ mode: 'income', amount: '100', income: { source: 'Gift', name: '', frequency: 'once', startDate: '2026-11-04', endDate: '' } }),
    base({ repeat: { on: true, frequency: 'daily', interval: 2, daysOfWeek: [3], endType: 'unlimited', count: 10, endDate: '' } }),
    base({ amount: '7' }),
  ], categories).map((prepared, key) => ({ key, prepared }));
  const calls: string[] = [];
  const result = await saveEntries(items, {
    spending: async input => { calls.push(`spending ${input.amount}`); },
    income: async input => { calls.push(`income ${input.amount}`); },
    repeat: async () => { calls.push('repeat'); throw new Error('network'); },
  });
  assert.deepEqual(calls, ['spending 45000', 'income 100', 'repeat']);
  assert.deepEqual(result.saved.map(item => item.key), [0, 1]);
  assert.deepEqual(result.remaining.map(item => item.key), [2, 3]);
  assert.match(String(result.error), /network/);
});

test('the next entry keeps mode, category, day and time but clears amount, text and repeat', () => {
  const entry = base({ description: 'Phở', category: 'gas', repeat: { on: true, frequency: 'monthly', interval: 1, daysOfWeek: [3], endType: 'unlimited', count: 10, endDate: '' } });
  const next = nextQuickEntry(entry);
  assert.equal(next.amount, '');
  assert.equal(next.description, '');
  assert.equal(next.category, 'gas');
  assert.equal(next.date, entry.date);
  assert.equal(next.repeat.on, false);
});

test('editing loads an existing spending as whole đồng', () => {
  const entry = entryFromSpending({ id: 's1', amount: 42000, description: 'Xăng', category: 'gas', date: '2026-11-03', time: '18:20' }, categories);
  assert.equal(entry.amount, '42000');
  assert.equal(entry.category, 'gas');
  assert.equal(entry.date, '2026-11-03');
  assert.equal(entry.time, '18:20');
});

test('summaries read naturally for chips', () => {
  assert.equal(dayLabel('2026-11-04', NOW), 'Today');
  assert.equal(dayLabel('2026-11-03', NOW), 'Yesterday');
  assert.equal(dayLabel('2026-11-05', NOW), 'Tomorrow');
  assert.equal(dayLabel('2026-11-10', NOW), 'Tue 10 Nov');
  const repeat = { on: true, frequency: 'weekly' as const, interval: 1, daysOfWeek: [0, 1], endType: 'occurrences' as const, count: 3, endDate: '' };
  assert.equal(repeatSummary(repeat, NOW), 'Weekly · Mon, Sun · 3×');
  assert.equal(repeatSummary({ ...repeat, on: false }, NOW), 'Once');
  assert.equal(repeatSummary({ ...repeat, frequency: 'daily', interval: 2, endType: 'unlimited' }, NOW), 'Every 2 days');
  assert.equal(incomeSummary({ source: 'Salary', name: '', frequency: 'monthly', startDate: '2026-11-04', endDate: '' }, NOW), 'Monthly from Today');
});
