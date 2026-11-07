import type { Plan, PlanInput } from '../types';
import { describePlanSchedule, type PlanFrequency } from './plans';

/** Form state for creating or editing a plan; every field is the raw input value. */
export interface PlanDraft {
  id?: string;
  amount: string;
  description: string;
  category: string;
  time: string;
  startDate: string;
  frequency: PlanFrequency;
  interval: string;
  daysOfWeek: number[];
  endDate: string;
  /** Commitment (fixed amount and date) vs estimate. */
  sure: boolean;
  /** Editing only: '' = change every upcoming occurrence; a date = split from that date on. */
  effectiveFrom: string;
}

export const PLAN_FREQUENCY_LABELS: Record<PlanFrequency, string> = {
  once: 'Once', daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly',
};

/** Quick starts for the most common forecasts. */
export const PLAN_PRESETS: { label: string; description: string; amount: number; time: string; frequency: PlanFrequency; category: string }[] = [
  { label: 'Breakfast', description: 'Breakfast', amount: 15000, time: '07:30', frequency: 'weekdays', category: 'Food' },
  { label: 'Lunch', description: 'Lunch', amount: 35000, time: '12:00', frequency: 'weekdays', category: 'Food' },
  { label: 'Coffee', description: 'Coffee', amount: 25000, time: '09:30', frequency: 'weekdays', category: 'Food' },
  { label: 'Dinner', description: 'Dinner', amount: 50000, time: '19:00', frequency: 'daily', category: 'Food' },
  { label: 'Fuel', description: 'Fuel', amount: 100000, time: '08:00', frequency: 'weekly', category: 'Transport' },
];

export function createPlanDraft(today: string, defaultCategory: string, plan?: Plan): PlanDraft {
  if (plan) {
    return {
      id: plan.id, amount: String(plan.amount), description: plan.description, category: plan.category,
      time: plan.time, startDate: plan.startDate, frequency: plan.frequency, interval: String(plan.interval),
      daysOfWeek: [...plan.daysOfWeek], endDate: plan.endDate ?? '', sure: plan.sure, effectiveFrom: '',
    };
  }
  return {
    amount: '', description: '', category: defaultCategory, time: '12:00', startDate: today,
    frequency: 'weekdays', interval: '1', daysOfWeek: [], endDate: '', sure: false, effectiveFrom: '',
  };
}

export function isPlanDraftDirty(draft: PlanDraft, snapshot: PlanDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(snapshot);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates the draft and returns the API input; throws an Error with a user-facing message. */
export function validatePlanDraft(draft: PlanDraft): PlanInput {
  const amount = Number(draft.amount.replace(/[\s,_]/g, ''));
  if (!draft.amount.trim() || !Number.isFinite(amount) || amount <= 0 || amount > 1e12 || !/^\d+(?:\.\d{1,2})?$/.test(String(amount))) {
    throw new Error('Enter an amount above 0 ₫ with at most two decimals.');
  }
  if (draft.description.length > 1000) throw new Error('Keep the description under 1,000 characters.');
  if (!draft.category) throw new Error('Choose a category.');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) throw new Error('Choose a time.');
  if (!DATE.test(draft.startDate)) throw new Error('Choose a start date.');
  const interval = draft.frequency === 'daily' || draft.frequency === 'weekly' || draft.frequency === 'monthly'
    ? Number(draft.interval || '1') : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) throw new Error('Repeat every 1 to 365 periods.');
  let endDate: string | null = null;
  if (draft.frequency !== 'once' && draft.endDate) {
    if (!DATE.test(draft.endDate)) throw new Error('Choose a valid end date.');
    if (draft.endDate < draft.startDate) throw new Error('The end date cannot be before the start date.');
    endDate = draft.endDate;
  }
  return {
    amount, description: draft.description.trim(), category: draft.category, time: draft.time,
    startDate: draft.startDate, frequency: draft.frequency, interval,
    daysOfWeek: draft.frequency === 'weekly' ? [...new Set(draft.daysOfWeek)].sort((a, b) => a - b) : [],
    endDate,
    sure: draft.sure,
  };
}

/** Human summary of what the draft will do, or null until it has an amount. */
export function describePlanDraft(draft: PlanDraft): string | null {
  try {
    const input = validatePlanDraft(draft);
    const amount = `${input.amount.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ₫`;
    const until = input.frequency === 'once' ? '' : input.endDate ? ` until ${input.endDate}` : ', with no end';
    const from = input.frequency === 'once' ? '' : ` from ${input.startDate}`;
    return `${amount} · ${describePlanSchedule(input)} at ${input.time}${from}${until}. Each one becomes a real spending once its time passes.`;
  } catch {
    return null;
  }
}
