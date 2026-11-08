import type { BudgetPeriodSetting, ShowBy } from './lib/periods';
import type { PlanException, PlanFrequency } from './lib/plans';

export type Category = string;

export interface CategoryData {
  id: string;
  name: string;
  color: string;
  icon: string;
  /** Hidden from pickers; kept so past spendings and plans still show its name, color and icon. */
  archived?: boolean;
}

export interface Spending {
  id: string;
  amount: number;
  description: string;
  category: Category;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  repeatRuleId?: string | null;
  planId?: string | null; // set when this spending was materialized from a plan
  planDate?: string | null; // the plan occurrence date it came from
}

/** A forecast spending. Future occurrences are projected, never stored, until their time passes. */
export interface PlanInput {
  amount: number;
  description: string;
  category: string;
  time: string; // HH:mm
  startDate: string; // YYYY-MM-DD
  frequency: PlanFrequency;
  interval: number;
  daysOfWeek: number[]; // weekly only, 0=Sun..6=Sat
  endDate: string | null; // inclusive, null = forever
  sure: boolean; // commitment (fixed amount and date) vs estimate
}

export interface Plan extends PlanInput {
  id: string;
  materializedThrough: string; // local YYYY-MM-DDTHH:mm
  createdAt: string;
  exceptions: PlanException[];
}

export type PlanExceptionInput = Omit<PlanException, 'date'>;

export type RepeatFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly';
export type RepeatEndType = 'unlimited' | 'occurrences' | 'until_date';

export interface RepeatRuleInput {
  amount: number;
  description: string;
  category: string;
  startDate: string; // YYYY-MM-DD
  time: string; // HH:mm
  frequency: RepeatFrequency;
  interval?: number;
  daysOfWeek?: number[];
  endType: RepeatEndType;
  totalOccurrences?: number | null;
  endDate?: string | null;
}

export interface RepeatRule extends RepeatRuleInput {
  id: string;
  userId: string;
  occurrencesCreated: number;
  lastGeneratedDate: string | null;
  createdAt: string;
}

export type IncomeFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';
// Quick entry only offers IncomeFrequency; a twice-a-month schedule needs two days, so it is set in the income form.
export type IncomeScheduleFrequency = IncomeFrequency | 'semimonthly';

export interface IncomeInput {
  source: string; // e.g. Salary, Freelance, Gift
  name: string; // e.g. employer or client; may be empty
  amount: number; // paid per occurrence
  frequency: IncomeScheduleFrequency;
  startDate: string; // YYYY-MM-DD; the payment date for one-time income
  endDate: string | null; // YYYY-MM-DD inclusive; null = no end (always null for one-time income)
  interval?: 1 | 2 | 4; // weekly only: every N weeks; omitted = 1
  semimonthlyDays?: [number, number]; // semimonthly only: two days of the month (1-31, first < second; 31 = last day)
  weekendShift?: boolean; // paid on the Friday before a Saturday or Sunday payday; omitted = false
}

export interface Income extends IncomeInput {
  id: string;
}

export type ViewMode = 'month' | 'cycle' | 'week' | 'day' | 'profile' | 'analytics';

export interface UserSettings {
  theme: 'dark' | 'light';
  name: string;
  email: string;
  avatar: string;
  categories: CategoryData[];
  budgetPeriod: BudgetPeriodSetting;
  showBy: ShowBy;
}
