import type { SpendingInput } from './finance';
import type { CategoryData, Spending } from './types';

export interface ExpenseDraft {
  id?: string;
  amount: string;
  description: string;
  category: string;
  date: string;
  time: string;
}

type Categories = readonly Pick<CategoryData, 'id'>[];
const pad = (value: number, length = 2) => String(value).padStart(length, '0');

export function createExpenseDraft(categories: Categories, expense?: Spending, now = new Date()): ExpenseDraft {
  if (expense) {
    return {
      id: expense.id,
      amount: String(expense.amount),
      description: expense.description,
      category: expense.category,
      date: expense.date,
      time: expense.time,
    };
  }
  return {
    amount: '',
    description: '',
    category: categories[0]?.id ?? '',
    date: `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

function isValidDate(date: string): boolean {
  if (date.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  // Calendar arithmetic avoids timezone/DST shifts and Date's special handling of years 0–99.
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

export function validateExpenseDraft(draft: ExpenseDraft, categories: Categories): SpendingInput {
  const amount = Number(draft.amount);
  if (draft.amount !== draft.amount.trim() || !/^\d+(?:\.\d{1,2})?$/.test(draft.amount) || !Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
    throw new Error('Enter a positive amount up to 1,000,000,000,000 with at most two decimal places.');
  }
  if (!draft.description.trim() || draft.description.length > 500) {
    throw new Error('Enter a description between 1 and 500 characters.');
  }
  if (!categories.some(category => category.id === draft.category)) {
    throw new Error('Choose an available category from settings.');
  }
  if (!isValidDate(draft.date)) throw new Error('Enter a valid date.');
  if (draft.time.length !== 5 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) {
    throw new Error('Enter a valid time in HH:mm format.');
  }
  return {
    amount,
    description: draft.description.trim(),
    category: draft.category,
    date: draft.date,
    time: draft.time,
  };
}

export function isExpenseDraftDirty(draft: ExpenseDraft, initial: ExpenseDraft): boolean {
  return draft.id !== initial.id || draft.amount !== initial.amount ||
    draft.description !== initial.description || draft.category !== initial.category ||
    draft.date !== initial.date || draft.time !== initial.time;
}
