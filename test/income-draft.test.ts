import assert from 'node:assert/strict';
import test from 'node:test';
import { createIncomeDraft, describeIncomeDraft, isIncomeDraftDirty, isValidIncomeDate, validateIncomeDraft } from '../src/lib/incomeDraft';
import type { IncomeDraft } from '../src/lib/incomeDraft';
import type { Income } from '../src/types';

const saved: Income = { id: 'income-1', source: 'Salary', name: 'Company', amount: 20000000, frequency: 'monthly', startDate: '2026-01-05', endDate: null };
const valid: IncomeDraft = { source: ' Freelance ', name: ' Client A ', amount: '1500000.5', frequency: 'weekly', startDate: '2026-10-05', endDate: '2026-12-31' };

test('new drafts default to a monthly income on the given date; edits copy the saved income', () => {
  assert.deepEqual(createIncomeDraft('2026-10-22'), { source: '', name: '', amount: '', frequency: 'monthly', startDate: '2026-10-22', endDate: '' });
  assert.deepEqual(createIncomeDraft('2026-10-22', saved), { id: 'income-1', source: 'Salary', name: 'Company', amount: '20000000', frequency: 'monthly', startDate: '2026-01-05', endDate: '' });
  assert.equal(createIncomeDraft('2026-10-22', { ...saved, endDate: '2026-12-31' }).endDate, '2026-12-31');
});

test('valid drafts produce trimmed input with numeric amounts and nullable end dates', () => {
  assert.deepEqual(validateIncomeDraft(valid), { source: 'Freelance', name: 'Client A', amount: 1500000.5, frequency: 'weekly', startDate: '2026-10-05', endDate: '2026-12-31' });
  assert.equal(validateIncomeDraft({ ...valid, endDate: '' }).endDate, null);
  assert.equal(validateIncomeDraft({ ...valid, name: '' }).name, '');
  // One-time income ignores a leftover end date from another frequency.
  assert.deepEqual(validateIncomeDraft({ ...valid, frequency: 'once' }).endDate, null);
  assert.equal(validateIncomeDraft({ ...valid, endDate: valid.startDate }).endDate, valid.startDate);
});

test('invalid drafts are rejected with a helpful message', () => {
  const invalid: [Partial<IncomeDraft>, RegExp][] = [
    [{ source: '   ' }, /source/], [{ source: 'a'.repeat(101) }, /source/], [{ source: 'bad\ntext' }, /source/],
    [{ name: 'a'.repeat(501) }, /name/], [{ name: 'bad\u0000' }, /name/],
    [{ amount: '' }, /amount/], [{ amount: '0' }, /amount/], [{ amount: '-1' }, /amount/], [{ amount: '1.234' }, /amount/],
    [{ amount: ' 1' }, /amount/], [{ amount: '1000000000000.01' }, /amount/], [{ amount: 'abc' }, /amount/],
    [{ frequency: 'hourly' as IncomeDraft['frequency'] }, /how often/],
    [{ startDate: '' }, /start date/], [{ startDate: '2026-02-30' }, /start date/], [{ startDate: '0000-01-01' }, /start date/],
    [{ frequency: 'once', startDate: '2026-13-01' }, /date for this income/],
    [{ endDate: '2026-10-04' }, /before the start date/], [{ endDate: '2026-02-30' }, /end date/],
  ];
  for (const [patch, message] of invalid) assert.throws(() => validateIncomeDraft({ ...valid, ...patch }), message, JSON.stringify(patch));
});

test('isValidIncomeDate checks real Gregorian dates', () => {
  for (const date of ['2024-02-29', '0001-01-01', '9999-12-31']) assert.equal(isValidIncomeDate(date), true, date);
  for (const date of ['2023-02-29', '2026-04-31', '2026-1-01', '', '2026-10-05T00:00']) assert.equal(isValidIncomeDate(date), false, date);
});

test('dirty detection compares every field against the opening snapshot', () => {
  const snapshot = createIncomeDraft('2026-10-22', saved);
  assert.equal(isIncomeDraftDirty({ ...snapshot }, snapshot), false);
  for (const field of ['source', 'name', 'amount', 'startDate', 'endDate'] as const) {
    assert.equal(isIncomeDraftDirty({ ...snapshot, [field]: `${snapshot[field]}x` }, snapshot), true, field);
  }
  assert.equal(isIncomeDraftDirty({ ...snapshot, frequency: 'yearly' }, snapshot), true);
});

test('income draft: describes the schedule in plain language', () => {
  assert.equal(describeIncomeDraft({ amount: '', frequency: 'monthly', startDate: '2026-10-22', endDate: '' }), null);
  assert.equal(describeIncomeDraft({ amount: '12abc', frequency: 'monthly', startDate: '2026-10-22', endDate: '' }), null);
  assert.equal(describeIncomeDraft({ amount: '32000000', frequency: 'monthly', startDate: '2026-10-22', endDate: '' }), '32.000.000 ₫ on day 22 of every month, from 22 Oct 2026, with no end date.');
  assert.equal(describeIncomeDraft({ amount: '500000', frequency: 'once', startDate: '2026-10-22', endDate: '' }), '500.000 ₫ once, on Thursday, 22 Oct 2026.');
  assert.equal(describeIncomeDraft({ amount: '1500000', frequency: 'weekly', startDate: '2026-10-23', endDate: '2026-12-31' }), '1.500.000 ₫ every Friday, from 23 Oct 2026, until 31 Dec 2026.');
  assert.equal(describeIncomeDraft({ amount: '100', frequency: 'yearly', startDate: '2026-01-20', endDate: '' }), '100 ₫ every year on 20 Jan, from 20 Jan 2026, with no end date.');
  assert.match(describeIncomeDraft({ amount: '100', frequency: 'monthly', startDate: '2026-01-31', endDate: '' })!, /shorter months/);
});
