import { incomeMonth } from './income';
import type { IncomeEntry, IncomeEntryInput } from '../types';

export interface IncomeEntryDraft {
  id?: string;
  month: string;
  amount: string;
  description: string;
}

export function isValidIncomeMonth(month: string): boolean {
  return month.length === 7 && /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(month);
}

export function createIncomeEntryDraft(selectedMonth = incomeMonth(new Date()), entry?: IncomeEntry): IncomeEntryDraft {
  if (entry) {
    return { id: entry.id, month: entry.month, amount: String(entry.amount), description: entry.description };
  }
  return { month: selectedMonth, amount: '', description: '' };
}

export function validateIncomeEntryDraft(draft: IncomeEntryDraft): IncomeEntryInput {
  if (!isValidIncomeMonth(draft.month)) {
    throw new Error('Choose a valid month in YYYY-MM format, with a year from 0001 to 9999.');
  }
  const amount = Number(draft.amount);
  if (draft.amount !== draft.amount.trim() || !/^\d+(?:\.\d{1,2})?$/.test(draft.amount) || !Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
    throw new Error('Enter a positive amount up to 1,000,000,000,000 with at most two decimal places.');
  }
  if (!draft.description.trim() || draft.description.length > 500) {
    throw new Error('Enter a description between 1 and 500 characters.');
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(draft.description)) {
    throw new Error('The description must not contain control characters.');
  }
  return { month: draft.month, amount, description: draft.description.trim() };
}

export function isIncomeEntryDraftDirty(draft: IncomeEntryDraft, snapshot: IncomeEntryDraft): boolean {
  return draft.id !== snapshot.id || draft.month !== snapshot.month ||
    draft.amount !== snapshot.amount || draft.description !== snapshot.description;
}
