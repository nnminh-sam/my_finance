import assert from 'node:assert/strict';
import test from 'node:test';
import { createExpenseDraft, isExpenseDraftDirty, validateExpenseDraft } from '../src/expenseDraft';
import type { ExpenseDraft } from '../src/expenseDraft';
import type { Spending } from '../src/types';

const categories = [
  { id: 'food', name: 'Food', color: '#123456', icon: 'Utensils' },
  { id: 'travel', name: 'Travel', color: '#654321', icon: 'Car' },
];
const expense: Spending = {
  id: 'original', amount: 12.34, description: 'Lunch', category: 'travel',
  date: '2020-02-29', time: '23:59',
};
const validDraft = (overrides: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  amount: '12.34', description: 'Lunch', category: 'food', date: '2026-10-11', time: '12:30',
  ...overrides,
});

test('new drafts regenerate local date and time for each open from one supplied instant', () => {
  const firstNow = new Date(2026, 9, 11, 23, 59, 59);
  const nextNow = new Date(2026, 9, 12, 0, 0, 1);
  const before = firstNow.getTime();
  const first = createExpenseDraft(categories, undefined, firstNow);
  const next = createExpenseDraft(categories, undefined, nextNow);
  assert.deepEqual(first, {
    amount: '', description: '', category: 'food', date: '2026-10-11', time: '23:59',
  });
  assert.equal(next.date, '2026-10-12');
  assert.equal(next.time, '00:00');
  assert.notStrictEqual(first, next);
  assert.equal(firstNow.getTime(), before);
  assert.equal(createExpenseDraft([], undefined, firstNow).category, '');
});

test('omitting now defaults to the current local date and time', () => {
  const before = new Date();
  const draft = createExpenseDraft(categories);
  const after = new Date();
  assert.ok([before, after].some(now => {
    const expected = createExpenseDraft(categories, undefined, now);
    return expected.date === draft.date && expected.time === draft.time;
  }));
});

test('defaults use local calendar fields instead of UTC in opposite-offset timezones', () => {
  const originalTimezone = process.env.TZ;
  const instant = new Date('2026-01-01T10:30:00Z');
  try {
    process.env.TZ = 'Pacific/Honolulu';
    const west = createExpenseDraft(categories, undefined, instant);
    assert.equal(west.date, '2026-01-01');
    assert.equal(west.time, '00:30');
    process.env.TZ = 'Pacific/Kiritimati';
    const east = createExpenseDraft(categories, undefined, instant);
    assert.equal(east.date, '2026-01-02');
    assert.equal(east.time, '00:30');
    assert.equal(validateExpenseDraft({ ...east, amount: '1', description: 'Local expense' }, categories).date, east.date);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('edit drafts preserve original fields even when the category no longer exists', () => {
  const before = { ...expense };
  const draft = createExpenseDraft(categories, expense, new Date(2030, 0, 1));
  assert.deepEqual(draft, {
    id: 'original', amount: '12.34', description: 'Lunch', category: 'travel',
    date: '2020-02-29', time: '23:59',
  });
  assert.deepEqual(expense, before);
  const missingCategory = createExpenseDraft([], expense);
  assert.equal(missingCategory.category, 'travel');
  assert.throws(() => validateExpenseDraft(missingCategory, []), /available category/);
  assert.throws(() => validateExpenseDraft(draft, [categories[0]]), /available category/);
});

test('validation returns a trimmed SpendingInput without mutating the draft or including its id', () => {
  const draft = validDraft({ id: 'original', description: '  Lunch  ', date: '0001-01-01', time: '00:00' });
  const before = { ...draft };
  assert.deepEqual(validateExpenseDraft(draft, categories), {
    amount: 12.34, description: 'Lunch', category: 'food', date: '0001-01-01', time: '00:00',
  });
  assert.deepEqual(draft, before);
});

test('date and time overrides are saved literally, not replaced by edit originals or current defaults', () => {
  const draft = {
    ...createExpenseDraft(categories, expense), date: '9999-12-31', time: '00:01',
  };
  const input = validateExpenseDraft(draft, categories);
  assert.equal(input.date, '9999-12-31');
  assert.equal(input.time, '00:01');
  assert.equal(expense.date, '2020-02-29');
  assert.equal(expense.time, '23:59');
});

test('amount accepts positive values up to the inclusive limit with at most two decimal places', () => {
  for (const amount of ['0.01', '1', '1.2', '1.23', '0001.20', '1000000000000', '1000000000000.00']) {
    assert.equal(validateExpenseDraft(validDraft({ amount }), categories).amount, Number(amount));
  }
  for (const amount of ['', ' ', '0', '0.00', '-1', '+1', '.5', '1.', '1.234', '1e3', 'NaN', 'Infinity', '1,000', ' 1', '1 ', '1\n', '1000000000000.01', '1000000000001', '9'.repeat(400)]) {
    assert.throws(() => validateExpenseDraft(validDraft({ amount }), categories), /positive amount/, amount);
  }
});

test('description has a nonblank value and a maximum raw length of 500', () => {
  for (const description of ['A', 'a'.repeat(500)]) {
    assert.equal(validateExpenseDraft(validDraft({ description }), categories).description, description);
  }
  for (const description of ['', ' \n\t ', 'a'.repeat(501), ` ${'a'.repeat(500)}`]) {
    assert.throws(() => validateExpenseDraft(validDraft({ description }), categories), /description between/);
  }
});

test('category must still be present in current settings', () => {
  assert.equal(validateExpenseDraft(validDraft({ category: 'travel' }), categories).category, 'travel');
  for (const category of ['', 'deleted', 'Food']) {
    assert.throws(() => validateExpenseDraft(validDraft({ category }), categories), /available category/);
  }
  assert.throws(() => validateExpenseDraft(validDraft(), []), /available category/);
});

test('dates require real Gregorian days and four-digit years from 0001 through 9999', () => {
  for (const date of ['0001-01-01', '0099-12-31', '1900-02-28', '2000-02-29', '2024-02-29', '9999-12-31']) {
    assert.equal(validateExpenseDraft(validDraft({ date }), categories).date, date);
  }
  for (const date of ['', '0000-01-01', '10000-01-01', '2026-1-01', '2026-01-1', '2026-00-10', '2026-13-01', '2026-01-00', '2026-01-32', '2026-04-31', '2026-02-29', '1900-02-29', '2100-02-29', '2024-02-30', '2026-10-11T00:00:00Z', ' 2026-10-11', '2026-10-11\n']) {
    assert.throws(() => validateExpenseDraft(validDraft({ date }), categories), /valid date/, date);
  }
});

test('time requires exactly HH:mm in the 24-hour range', () => {
  for (const time of ['00:00', '09:05', '12:30', '23:59']) {
    assert.equal(validateExpenseDraft(validDraft({ time }), categories).time, time);
  }
  for (const time of ['', '24:00', '23:60', '9:05', '09:5', '12:30:00', '12:30Z', ' 12:30', '12:30 ', '12:30\n']) {
    assert.throws(() => validateExpenseDraft(validDraft({ time }), categories), /valid time/, time);
  }
});

test('dirty checks compare each raw field against the opening snapshot and clear on reversion', () => {
  const initial = createExpenseDraft(categories, undefined, new Date(2026, 9, 11, 12, 30));
  assert.equal(isExpenseDraftDirty(initial, initial), false);
  assert.equal(isExpenseDraftDirty({ ...initial }, initial), false);
  const changes: Partial<ExpenseDraft>[] = [
    { id: 'different' }, { amount: '1' }, { description: ' ' }, { category: 'travel' },
    { date: '2026-10-12' }, { time: '12:31' },
  ];
  for (const change of changes) {
    const changed = { ...initial, ...change };
    assert.equal(isExpenseDraftDirty(changed, initial), true);
    assert.equal(isExpenseDraftDirty({ ...changed, ...initial, id: initial.id }, initial), false);
  }
  const edit = createExpenseDraft(categories, expense);
  assert.equal(isExpenseDraftDirty({ ...edit }, edit), false);
  assert.equal(isExpenseDraftDirty({ ...edit, amount: '12.340' }, edit), true);
  assert.equal(isExpenseDraftDirty({ ...edit, description: 'Lunch ' }, edit), true);
});
