import assert from 'node:assert/strict';
import test from 'node:test';
import { nextExpenseDraft, prepareExpenseBatch, saveExpenseBatch, stageExpenseDraft } from '../src/lib/expenseBatch';
import type { PreparedExpense, QueuedExpense } from '../src/lib/expenseBatch';
import type { ExpenseDraft } from '../src/lib/expenseDraft';
import type { SpendingInput } from '../src/services/finance';

const categories = [{ id: 'food' }, { id: 'travel' }];
const validDraft = (overrides: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  amount: '12.34', description: 'Lunch', category: 'food', date: '2026-10-11', time: '12:30',
  ...overrides,
});
const blankDraft = (): ExpenseDraft => nextExpenseDraft(validDraft());
const queued = (): QueuedExpense[] => [
  { key: 0, draft: validDraft({ description: 'First' }) },
  { key: 1, draft: validDraft({ description: 'Second' }) },
  { key: 2, draft: validDraft({ description: 'Third' }) },
];
const prepared = (): PreparedExpense[] => prepareExpenseBatch(queued(), blankDraft(), null, 3, categories);

test('staging appends a new key and clones the draft without mutating the queue', () => {
  const queue = Object.freeze([{ key: 0, draft: Object.freeze(validDraft()) }]);
  const draft = validDraft({ id: 'original', description: 'Dinner' });
  const before = { ...draft };
  const result = stageExpenseDraft(queue, draft, 1);
  assert.deepEqual(result, [queue[0], { key: 1, draft: before }]);
  assert.notStrictEqual(result, queue);
  assert.notStrictEqual(result[1].draft, draft);
  assert.deepEqual(queue, [{ key: 0, draft: validDraft() }]);
  assert.deepEqual(draft, before);
  draft.description = 'Changed editor';
  assert.equal(result[1].draft.description, 'Dinner');
  result[1].draft.amount = '99';
  assert.equal(draft.amount, '12.34');
});

test('staging replaces an existing key in the same position without mutation', () => {
  const queue = Object.freeze(queued().map(entry => Object.freeze({ ...entry, draft: Object.freeze(entry.draft) })));
  const draft = Object.freeze(validDraft({ description: 'Edited second' }));
  const result = stageExpenseDraft(queue, draft, 1);
  assert.deepEqual(result.map(entry => entry.key), [0, 1, 2]);
  assert.equal(result[1].draft.description, 'Edited second');
  assert.notStrictEqual(result[1], queue[1]);
  assert.notStrictEqual(result[1].draft, draft);
  assert.deepEqual(queue, queued());
  assert.deepEqual(draft, validDraft({ description: 'Edited second' }));
});

test('next draft blanks amount and description, preserves category/date/time, and omits id', () => {
  const draft = Object.freeze(validDraft({ id: 'original', category: 'travel', date: '2020-02-29', time: '23:59' }));
  const result = nextExpenseDraft(draft);
  assert.deepEqual(result, { amount: '', description: '', category: 'travel', date: '2020-02-29', time: '23:59' });
  assert.equal('id' in result, false);
  assert.notStrictEqual(result, draft);
  assert.notStrictEqual(result, nextExpenseDraft(draft));
  assert.equal(draft.amount, '12.34');
  assert.equal(draft.description, 'Lunch');
  assert.equal(draft.id, 'original');
});

test('preparation ignores a blank fresh trailing editor and clones queued drafts', () => {
  const queue = Object.freeze(queued().map(entry => Object.freeze({ ...entry, draft: Object.freeze(entry.draft) })));
  const draft = Object.freeze(blankDraft());
  const result = prepareExpenseBatch(queue, draft, null, 3, categories);
  assert.deepEqual(result.map(entry => entry.key), [0, 1, 2]);
  for (const [index, entry] of result.entries()) {
    assert.notStrictEqual(entry.draft, queue[index].draft);
    assert.deepEqual(entry.draft, queue[index].draft);
    assert.deepEqual(entry.input, {
      amount: 12.34, description: queue[index].draft.description,
      category: 'food', date: '2026-10-11', time: '12:30',
    });
  }
  assert.deepEqual(queue, queued());
  assert.deepEqual(draft, blankDraft());
});

test('preparation appends a filled fresh editor using nextKey and retains raw draft fields', () => {
  const queue = queued();
  const draft = validDraft({ id: 'original', description: '  Dinner  ' });
  const result = prepareExpenseBatch(queue, draft, null, 7, categories);
  assert.deepEqual(result.map(entry => entry.key), [0, 1, 2, 7]);
  assert.deepEqual(result[3].draft, draft);
  assert.notStrictEqual(result[3].draft, draft);
  assert.equal(result[3].input.description, 'Dinner');
  assert.equal('id' in result[3].input, false);
  assert.deepEqual(queue, queued());
  assert.equal(draft.description, '  Dinner  ');
});

test('preparation upserts active edits in place, including key zero, without duplicates', () => {
  for (const activeKey of [0, 1, 2]) {
    const queue = queued();
    const draft = validDraft({ description: 'Edited' });
    const result = prepareExpenseBatch(queue, draft, activeKey, 99, categories);
    assert.deepEqual(result.map(entry => entry.key), [0, 1, 2]);
    assert.equal(result[activeKey].input.description, 'Edited');
    assert.deepEqual(queue, queued());
  }
  const result = prepareExpenseBatch(queued(), validDraft(), 8, 99, categories);
  assert.deepEqual(result.map(entry => entry.key), [0, 1, 2, 8]);
});

test('blank active edits and an empty queue are validated rather than ignored', () => {
  assert.throws(() => prepareExpenseBatch(queued(), blankDraft(), 1, 3, categories), /^Error: Expense 2: Enter a positive amount/);
  assert.throws(() => prepareExpenseBatch([], blankDraft(), null, 0, categories), /^Error: Expense 1: Enter a positive amount/);
});

test('partially filled and whitespace editors are included and rejected with their batch position', () => {
  const cases: [Partial<ExpenseDraft>, RegExp][] = [
    [{ amount: '1', description: '' }, /^Error: Expense 4: Enter a description/],
    [{ amount: '', description: 'Dinner' }, /^Error: Expense 4: Enter a positive amount/],
    [{ amount: ' ', description: '' }, /^Error: Expense 4: Enter a positive amount/],
    [{ amount: '', description: ' ' }, /^Error: Expense 4: Enter a positive amount/],
  ];
  for (const [overrides, error] of cases) {
    assert.throws(() => prepareExpenseBatch(queued(), { ...blankDraft(), ...overrides }, null, 3, categories), error);
  }
});

test('invalid queued categories prevent any writes, even after valid earlier drafts', async () => {
  const queue = queued();
  queue[1].draft.category = 'deleted';
  const before = queue.map(entry => ({ ...entry, draft: { ...entry.draft } }));
  const calls: SpendingInput[] = [];
  await assert.rejects(async () => {
    const entries = prepareExpenseBatch(queue, validDraft(), null, 3, categories);
    await saveExpenseBatch(entries, async input => { calls.push(input); });
  }, /^Error: Expense 2: Choose an available category from settings\./);
  assert.deepEqual(calls, []);
  assert.deepEqual(queue, before);
});

test('preparation applies existing date and time validation to every queued draft', () => {
  for (const [overrides, error] of [
    [{ date: '2026-02-29' }, /^Error: Expense 3: Enter a valid date\./],
    [{ time: '24:00' }, /^Error: Expense 3: Enter a valid time in HH:mm format\./],
  ] as const) {
    const queue = queued();
    queue[2].draft = validDraft(overrides);
    assert.throws(() => prepareExpenseBatch(queue, blankDraft(), null, 3, categories), error);
  }
});

test('saving waits for each write to resolve before attempting the next', async () => {
  const entries = prepared();
  const calls: SpendingInput[] = [];
  let releaseFirst!: () => void;
  const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve; });
  const pending = saveExpenseBatch(entries, async input => {
    calls.push(input);
    if (calls.length === 1) await firstWrite;
  });
  await Promise.resolve();
  assert.deepEqual(calls, [entries[0].input]);
  releaseFirst();
  const result = await pending;
  assert.deepEqual(calls, entries.map(entry => entry.input));
  assert.deepEqual(result, { saved: entries, remaining: [] });
});

test('partial failure returns confirmed successes and retries only failed and unattempted entries', async () => {
  const entries = Object.freeze(prepared().map(entry => Object.freeze({
    ...entry, draft: Object.freeze(entry.draft), input: Object.freeze(entry.input),
  })));
  const failure = new Error('Network unavailable');
  const events: string[] = [];
  const result = await saveExpenseBatch(entries, async input => {
    events.push(`start ${input.description}`);
    await Promise.resolve();
    if (input.description === 'Second') throw failure;
    events.push(`saved ${input.description}`);
  });
  assert.deepEqual(events, ['start First', 'saved First', 'start Second']);
  assert.deepEqual(result.saved, [entries[0]]);
  assert.deepEqual(result.remaining, [entries[1], entries[2]]);
  assert.strictEqual(result.error, failure);
  assert.strictEqual(result.saved[0], entries[0]);
  assert.strictEqual(result.remaining[0], entries[1]);
  const retryCalls: SpendingInput[] = [];
  const retry = await saveExpenseBatch(result.remaining, async input => { retryCalls.push(input); });
  assert.deepEqual(retryCalls, [entries[1].input, entries[2].input]);
  assert.deepEqual(retry, { saved: [entries[1], entries[2]], remaining: [] });
  assert.deepEqual(entries, prepared());
});

test('first-write failure preserves every entry and returns non-Error failures without throwing', async () => {
  const entries = prepared();
  const failure = { reason: 'offline' };
  let calls = 0;
  const result = await saveExpenseBatch(entries, () => {
    calls += 1;
    throw failure;
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { saved: [], remaining: entries, error: failure });
  assert.notStrictEqual(result.remaining, entries);
  assert.strictEqual(result.error, failure);
});

test('successful saves return all entries in order with no remaining entries or error', async () => {
  const entries = prepared();
  const before = prepared();
  const calls: SpendingInput[] = [];
  const result = await saveExpenseBatch(entries, async input => { calls.push(input); });
  assert.deepEqual(calls, entries.map(entry => entry.input));
  assert.deepEqual(result, { saved: entries, remaining: [] });
  assert.equal('error' in result, false);
  assert.notStrictEqual(result.saved, entries);
  assert.deepEqual(entries, before);
});

test('saving an empty batch succeeds without calling save', async () => {
  let calls = 0;
  const result = await saveExpenseBatch([], async () => { calls += 1; });
  assert.equal(calls, 0);
  assert.deepEqual(result, { saved: [], remaining: [] });
});
