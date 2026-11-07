import type { BudgetPeriodSetting } from "../../lib/periods";
import type { PlanException, PlanFrequency } from "../../lib/plans";

export interface Category { id: string; name: string; color: string; icon: string }

export interface FinanceSettings {
  avatar: string;
  categories: Category[];
  timezone: string; // IANA zone used to decide when planned spendings become real
  budgetPeriod: BudgetPeriodSetting;
}
export interface SettingsPatch {
  avatar?: string;
  categories?: Category[];
  timezone?: string;
  budgetPeriod?: { mode?: BudgetPeriodSetting["mode"]; startDay?: number; paycheckIncomeId?: string | null };
}
export interface SpendingInput { amount: number; description: string; category: string; date: string; time: string; repeatRuleId?: string | null }
export interface Spending extends SpendingInput {
  id: string;
  planId?: string | null; // set when materialized from a plan
  planDate?: string | null; // the plan occurrence date it came from
}
export interface SpendingPage { spendings: Spending[]; nextCursor: string | null }
export const INCOME_FREQUENCIES = ["once", "daily", "weekly", "semimonthly", "monthly", "yearly"] as const;
export type IncomeFrequency = typeof INCOME_FREQUENCIES[number];
export interface IncomeInput {
  source: string;
  name: string;
  amount: number;
  frequency: IncomeFrequency;
  startDate: string; // YYYY-MM-DD; the only date for one-time income
  endDate: string | null; // YYYY-MM-DD inclusive, null = no end; always null for one-time income
  interval?: 1 | 2 | 4; // weekly only; omitted = 1
  semimonthlyDays?: [number, number]; // semimonthly only; two ints 1..31, first < second
  weekendShift?: boolean; // omitted = false
}
export interface Income extends IncomeInput { id: string }
export interface IncomePage { incomes: Income[]; nextCursor: string | null }

export type RepeatFrequency = "daily" | "weekdays" | "weekly" | "monthly";
export type RepeatEndType = "unlimited" | "occurrences" | "until_date";

export interface RepeatRuleInput {
  amount: number;
  description: string;
  category: string;
  startDate: string; // YYYY-MM-DD
  time: string; // HH:mm
  frequency: RepeatFrequency;
  interval?: number; // 1-365, default 1
  daysOfWeek?: number[]; // [0..6] (0=Sun, 1=Mon, ..., 6=Sat)
  endType: RepeatEndType;
  totalOccurrences?: number; // 1-100 if endType === 'occurrences'
  endDate?: string; // YYYY-MM-DD if endType === 'until_date'
}

export interface RepeatRule extends RepeatRuleInput {
  id: string;
  userId: string;
  occurrencesCreated: number;
  lastGeneratedDate: string | null;
  createdAt: string;
}

export interface PlanInput {
  amount: number;
  description: string;
  category: string;
  time: string; // HH:mm
  startDate: string; // YYYY-MM-DD
  frequency: PlanFrequency;
  interval: number;
  daysOfWeek: number[];
  endDate: string | null;
  sure: boolean; // commitment (fixed amount and date) vs estimate
}

export interface Plan extends PlanInput {
  id: string;
  materializedThrough: string; // local YYYY-MM-DDTHH:mm; occurrences at or before it are real
  createdAt: string;
  exceptions: PlanException[]; // only occurrences not yet materialized
}

export type PlanExceptionInput = Omit<PlanException, "date">;

export const CATEGORY_ICONS = new Set([
  "Utensils", "Car", "Film", "ShoppingBag", "Receipt", "CircleDollarSign",
  "Coffee", "Home", "Heart", "Briefcase", "Gift", "Phone",
]);

export function defaultFinanceSettings(): FinanceSettings {
  return {
    avatar: "",
    timezone: "Asia/Ho_Chi_Minh",
    budgetPeriod: { mode: "calendar", startDay: 1, paycheckIncomeId: null },
    categories: [
      { id: "Food", name: "Food", color: "#10b981", icon: "Utensils" },
      { id: "Transport", name: "Transport", color: "#3b82f6", icon: "Car" },
      { id: "Entertainment", name: "Entertainment", color: "#8b5cf6", icon: "Film" },
      { id: "Shopping", name: "Shopping", color: "#f59e0b", icon: "ShoppingBag" },
      { id: "Bills", name: "Bills", color: "#ef4444", icon: "Receipt" },
      { id: "Other", name: "Other", color: "#6b7280", icon: "CircleDollarSign" },
    ],
  };
}
