// "Plan this period": the pure part. Turns what the user typed (bills, a daily amount, extras) into
// the plans to create, skips what is already planned, and works out what is left until the next payday.

import { parsePeriodParam, type BudgetPeriod } from './periods';
import { addDays, planDates } from './plans';
import type { PlanInput } from '../types';

export interface PlannerBill { name: string; amount: number; date: string }
export interface PlannerExtra { name: string; amount: number; date: string }
export interface PlannerInput {
  bills: readonly PlannerBill[];
  /** Amount spent per day on everyday things, or null for none. */
  dailyAmount: number | null;
  extras: readonly PlannerExtra[];
}
export interface PlannerCategories { bill: string; daily: string; extra: string }
export interface ExistingPlan { description: string; endDate: string | null; frequency?: string; startDate?: string }

/** The daily plan is named after its period, so planning the next period is not blocked by this period's plan. */
export const dailyPlanName = (period: Pick<BudgetPeriod, 'start' | 'end'>) => `Daily spending (${period.start} to ${period.end})`;
const BILL_TIME = '08:00';
const DAILY_TIME = '12:00';
const EXTRA_TIME = '12:00';

export const planKey = (description: string) => description.trim().toLowerCase();

/** A plan counts as "already planned" while it has no end date or ends today or later (a one-off: until its day has passed). */
export function plannedNames(plans: readonly ExistingPlan[], today: string): Set<string> {
  const active = (plan: ExistingPlan) => plan.frequency === 'once' && plan.startDate !== undefined
    ? plan.startDate >= today
    : !plan.endDate || plan.endDate >= today;
  return new Set(plans.filter(active).map(plan => planKey(plan.description)));
}

/** A day inside the period, and a real calendar date. */
export function dateInPeriod(period: Pick<BudgetPeriod, 'start' | 'end'>, date: string): boolean {
  return parsePeriodParam(date) !== null && date >= period.start && date <= period.end;
}

/**
 * The first day a bill or extra can take. The server starts a new plan's watermark at "now" and never back-fills, so an
 * occurrence on or before today is never projected or counted. That makes it the later of the period start and tomorrow.
 */
export function earliestPlanDate(period: Pick<BudgetPeriod, 'start'>, today: string): string {
  const tomorrow = addDays(today, 1);
  return tomorrow > period.start ? tomorrow : period.start;
}

/** A real day inside the period that is not yet over for the server. */
export function planDateAllowed(period: Pick<BudgetPeriod, 'start' | 'end'>, today: string, date: string): boolean {
  return dateInPeriod(period, date) && date >= earliestPlanDate(period, today);
}

/** The days a daily plan covers: from the later of today and the period start to the period end. Null when none is left. */
export function dailyPlanRange(period: Pick<BudgetPeriod, 'start' | 'end'>, today: string): { start: string; end: string } | null {
  const start = today > period.start ? today : period.start;
  return start > period.end ? null : { start, end: period.end };
}

export interface PlannerDraft {
  /** Plans to create now, in the order they are created. */
  plans: PlanInput[];
  /** Names of rows that match an active plan, shown and not created again. */
  alreadyPlanned: string[];
  /** Rows blocked because their date is not a real day inside the period. */
  blockedDates: string[];
}

export function planPeriodDraft(args: {
  period: Pick<BudgetPeriod, 'start' | 'end'>;
  today: string;
  input: PlannerInput;
  categories: PlannerCategories;
  existing: readonly ExistingPlan[];
}): PlannerDraft {
  const { period, today, input, categories } = args;
  const known = plannedNames(args.existing, today);
  const plans: PlanInput[] = [];
  const alreadyPlanned: string[] = [];
  const blockedDates: string[] = [];
  const seen = new Set<string>();

  const add = (name: string, plan: PlanInput) => {
    const key = planKey(name);
    if (known.has(key)) { alreadyPlanned.push(name.trim()); return; }
    // Two rows with the same name in one run would create a duplicate, so the second one is treated as planned.
    if (seen.has(key)) { alreadyPlanned.push(name.trim()); return; }
    seen.add(key);
    plans.push(plan);
  };

  for (const bill of input.bills) {
    const name = bill.name.trim();
    if (!name || !(bill.amount > 0)) continue;
    if (!planDateAllowed(period, today, bill.date)) { blockedDates.push(name); continue; }
    add(name, { amount: bill.amount, description: name, category: categories.bill, time: BILL_TIME, startDate: bill.date, frequency: 'monthly', interval: 1, daysOfWeek: [], endDate: null, sure: true });
  }

  const range = input.dailyAmount !== null && input.dailyAmount > 0 ? dailyPlanRange(period, today) : null;
  if (range && input.dailyAmount) {
    const dailyName = dailyPlanName(period);
    add(dailyName, { amount: input.dailyAmount, description: dailyName, category: categories.daily, time: DAILY_TIME, startDate: range.start, frequency: 'daily', interval: 1, daysOfWeek: [], endDate: range.end, sure: false });
  }

  for (const extra of input.extras) {
    const name = extra.name.trim();
    if (!name || !(extra.amount > 0)) continue;
    if (!planDateAllowed(period, today, extra.date)) { blockedDates.push(name); continue; }
    add(name, { amount: extra.amount, description: name, category: categories.extra, time: EXTRA_TIME, startDate: extra.date, frequency: 'once', interval: 1, daysOfWeek: [], endDate: null, sure: false });
  }

  return { plans, alreadyPlanned, blockedDates };
}

const cents = (amount: number) => Math.round(amount * 100);

/** What the draft adds to spending inside the period: every occurrence of every plan to create. */
export function draftTotal(period: Pick<BudgetPeriod, 'start' | 'end'>, plans: readonly PlanInput[]): number {
  const total = plans.reduce((sum, plan) => sum + cents(plan.amount) * planDates(plan, period.start, period.end).length, 0);
  return total / 100;
}

/** "Left until next payday" while the user types: the saved figure minus what the draft would add. */
export function leftAfterDraft(savedLeft: number, period: Pick<BudgetPeriod, 'start' | 'end'>, plans: readonly PlanInput[]): number {
  return (cents(savedLeft) - cents(draftTotal(period, plans))) / 100;
}

export interface CreateOutcome {
  created: PlanInput[];
  /** The plan that failed and why, or null when everything was created. Later plans were not tried. */
  failed: { plan: PlanInput; message: string } | null;
}

/** Creates the plans one at a time and stops at the first failure, so earlier plans stay and a retry skips them. */
export async function createPlansInOrder(
  plans: readonly PlanInput[],
  create: (plan: PlanInput) => Promise<unknown>,
  describeError: (failure: unknown) => string,
): Promise<CreateOutcome> {
  const created: PlanInput[] = [];
  for (const plan of plans) {
    try {
      await create(plan);
      created.push(plan);
    } catch (failure) {
      return { created, failed: { plan, message: describeError(failure) } };
    }
  }
  return { created, failed: null };
}

function pickCategory(categories: readonly { id: string; name: string }[], ...patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const found = categories.find(category => pattern.test(category.name) || pattern.test(category.id));
    if (found) return found.id;
  }
  return categories.find(category => /other/i.test(category.name))?.id ?? categories[0]?.id ?? '';
}

/** The categories new planner plans use, picked from the user's own list by name. */
export function plannerCategories(categories: readonly { id: string; name: string }[]): PlannerCategories {
  return {
    bill: pickCategory(categories, /bill/i, /utilit/i),
    daily: pickCategory(categories, /food|meal|eat|ăn/i),
    extra: pickCategory(categories, /gift|quà|parent/i),
  };
}
