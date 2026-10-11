import { validateExpenseDraft } from './expenseDraft';
import type { ExpenseDraft } from './expenseDraft';
import type { SpendingInput } from './finance';
import type { CategoryData } from './types';

export interface QueuedExpense {
  key: number;
  draft: ExpenseDraft;
}

export interface PreparedExpense extends QueuedExpense {
  input: SpendingInput;
}

export function stageExpenseDraft(queue: readonly QueuedExpense[], draft: ExpenseDraft, key: number): QueuedExpense[] {
  const entry = { key, draft: { ...draft } };
  const index = queue.findIndex(expense => expense.key === key);
  const staged = [...queue];
  if (index === -1) staged.push(entry);
  else staged[index] = entry;
  return staged;
}

export function nextExpenseDraft(draft: ExpenseDraft): ExpenseDraft {
  return {
    amount: '',
    description: '',
    category: draft.category,
    date: draft.date,
    time: draft.time,
  };
}

export function prepareExpenseBatch(
  queue: readonly QueuedExpense[],
  draft: ExpenseDraft,
  activeKey: number | null,
  nextKey: number,
  categories: readonly Pick<CategoryData, 'id'>[],
): PreparedExpense[] {
  const includeCurrent = activeKey !== null || draft.amount !== '' || draft.description !== '' || queue.length === 0;
  const staged = includeCurrent ? stageExpenseDraft(queue, draft, activeKey ?? nextKey) : queue;
  return staged.map((entry, index) => {
    try {
      return { key: entry.key, draft: { ...entry.draft }, input: validateExpenseDraft(entry.draft, categories) };
    } catch (error) {
      throw new Error(`Expense ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export async function saveExpenseBatch(
  entries: readonly PreparedExpense[],
  save: (input: SpendingInput) => Promise<void>,
): Promise<{ saved: PreparedExpense[]; remaining: PreparedExpense[]; error?: unknown }> {
  const saved: PreparedExpense[] = [];
  for (const [index, entry] of entries.entries()) {
    try {
      await save(entry.input);
    } catch (error) {
      return { saved, remaining: entries.slice(index), error };
    }
    saved.push(entry);
  }
  return { saved, remaining: [] };
}
