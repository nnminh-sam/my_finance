import assert from 'node:assert/strict';
import test from 'node:test';
import { incomeMonth } from '../src/lib/income';
import { createIncomeEntryDraft, isIncomeEntryDraftDirty, isValidIncomeMonth, validateIncomeEntryDraft } from '../src/lib/incomeEntryDraft';
import type { IncomeEntryDraft } from '../src/lib/incomeEntryDraft';
import type { IncomeEntry } from '../src/types';

const entry: IncomeEntry = { id: 'original', month: '2025-12', amount: 123.45, description: 'Bonus' };
const validDraft = (overrides: Partial<IncomeEntryDraft> = {}): IncomeEntryDraft => ({
  month: '2026-10', amount: '123.45', description: 'Bonus', ...overrides,
});

test('new drafts use the selected year-month and independent empty fields', () => {
  const first = createIncomeEntryDraft('2025-12');
  const next = createIncomeEntryDraft('2026-01');
  assert.deepEqual(first, { month: '2025-12', amount: '', description: '' });
  assert.deepEqual(next, { month: '2026-01', amount: '', description: '' });
  assert.notStrictEqual(first, createIncomeEntryDraft('2025-12'));
  first.description = 'One-off payment';
  assert.equal(next.description, '');
});

test('omitting the selected month defaults to the current local month', () => {
  const before = new Date();
  const draft = createIncomeEntryDraft();
  const after = new Date();
  assert.ok([before, after].some(now => draft.month === incomeMonth(now)));
});

test('month defaults use the local year and month, not UTC, across year boundaries', () => {
  const originalTimezone = process.env.TZ;
  const instant = new Date('2026-01-01T00:30:00Z');
  try {
    process.env.TZ = 'Pacific/Honolulu';
    const west = createIncomeEntryDraft(incomeMonth(instant));
    assert.equal(west.month, '2025-12');
    process.env.TZ = 'Pacific/Kiritimati';
    const east = createIncomeEntryDraft(incomeMonth(instant));
    assert.equal(east.month, '2026-01');
    assert.equal(instant.toISOString(), '2026-01-01T00:30:00.000Z');
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('edit drafts preserve every original field and id regardless of the selected month', () => {
  const before = { ...entry };
  const draft = createIncomeEntryDraft('2030-01', entry);
  assert.deepEqual(draft, { id: 'original', month: '2025-12', amount: '123.45', description: 'Bonus' });
  assert.deepEqual(entry, before);
  draft.description = 'Changed';
  assert.equal(entry.description, 'Bonus');
});

test('validation returns the complete trimmed input without id or mutation', () => {
  const draft = validDraft({ id: 'original', description: '  Bonus  ' });
  const before = { ...draft };
  assert.deepEqual(validateIncomeEntryDraft(draft), { month: '2026-10', amount: 123.45, description: 'Bonus' });
  assert.deepEqual(draft, before);
});

test('an edit can move to another month and change all values while retaining the original id', () => {
  const draft = { ...createIncomeEntryDraft('2030-01', entry), month: '2026-01', amount: '200.50', description: 'Updated bonus' };
  assert.deepEqual(validateIncomeEntryDraft(draft), { month: '2026-01', amount: 200.5, description: 'Updated bonus' });
  assert.equal(draft.id, 'original');
  assert.equal(entry.month, '2025-12');
});

test('months require exact YYYY-MM and years 0001 through 9999', () => {
  for (const month of ['0001-01', '0099-12', '2025-12', '2026-01', '9999-12']) {
    assert.equal(isValidIncomeMonth(month), true, month);
    assert.equal(validateIncomeEntryDraft(validDraft({ month })).month, month);
  }
  for (const month of ['', '0000-01', '10000-01', '-001-01', '2026-00', '2026-13', '2026-1', '026-01', '2026-01-01', '2026-01T00:00:00Z', ' 2026-01', '2026-01 ', '2026-01\n']) {
    assert.equal(isValidIncomeMonth(month), false, month);
    assert.throws(() => validateIncomeEntryDraft(validDraft({ month })), /valid month/, month);
  }
});

test('amounts must be positive, at most 1e12, and have no more than two decimal places', () => {
  for (const amount of ['0.01', '1', '1.2', '1.23', '0001.20', '1000000000000', '1000000000000.00']) {
    assert.equal(validateIncomeEntryDraft(validDraft({ amount })).amount, Number(amount), amount);
  }
  for (const amount of ['', ' ', '0', '0.00', '-1', '+1', '.5', '1.', '1.234', '1e3', 'NaN', 'Infinity', '1,000', ' 1', '1 ', '1\n', '1000000000000.01', '1000000000001', '9'.repeat(400)]) {
    assert.throws(() => validateIncomeEntryDraft(validDraft({ amount })), /positive amount/, amount);
  }
});

test('descriptions are required, trimmed, and limited to 500 raw characters', () => {
  for (const description of ['A', 'a'.repeat(500), '  Bonus  ', 'Thưởng tháng 10']) {
    assert.equal(validateIncomeEntryDraft(validDraft({ description })).description, description.trim());
  }
  for (const description of ['', '   ', 'a'.repeat(501), ` ${'a'.repeat(500)}`]) {
    assert.throws(() => validateIncomeEntryDraft(validDraft({ description })), /description between/);
  }
});

test('descriptions reject control characters even when trimming would remove them', () => {
  for (const control of ['\u0000', '\t', '\n', '\r', '\u001f', '\u007f', '\u0085', '\u009f']) {
    for (const description of [`Bonus${control}`, `Bo${control}nus`, `${control}Bonus`]) {
      assert.throws(() => validateIncomeEntryDraft(validDraft({ description })), /control characters/);
    }
  }
});

test('dirty state compares raw fields with the opening snapshot and clears on reversion', () => {
  const snapshot = createIncomeEntryDraft('2026-10');
  assert.equal(isIncomeEntryDraftDirty({ ...snapshot }, snapshot), false);
  const changes: Partial<IncomeEntryDraft>[] = [
    { id: 'different' }, { month: '2026-11' }, { amount: '1' }, { description: ' ' },
  ];
  for (const change of changes) {
    const draft = { ...snapshot, ...change };
    assert.equal(isIncomeEntryDraftDirty(draft, snapshot), true);
    assert.equal(isIncomeEntryDraftDirty({ ...draft, ...snapshot, id: snapshot.id }, snapshot), false);
  }
  const edit = createIncomeEntryDraft('2030-01', entry);
  assert.equal(isIncomeEntryDraftDirty({ ...edit }, edit), false);
  assert.equal(isIncomeEntryDraftDirty({ ...edit, amount: '123.450' }, edit), true);
  assert.equal(isIncomeEntryDraftDirty({ ...edit, description: 'Bonus ' }, edit), true);
});
