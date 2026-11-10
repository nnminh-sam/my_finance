import type { BudgetPeriodSetting, ShowBy } from "../../lib/periods";
import type { PlanException, PlanFrequency } from "../../lib/plans";

/** An archived category is hidden from pickers but kept, so past spendings keep its name, color and icon. */
export interface Category { id: string; name: string; color: string; icon: string; archived?: boolean }
export { MAX_CATEGORIES } from "../../lib/categories";

export interface FinanceSettings {
  avatar: string;
  categories: Category[];
  timezone: string; // IANA zone used to decide when planned spendings become real
  budgetPeriod: BudgetPeriodSetting;
  showBy: ShowBy; // which period Calendar, Week, Day, Analytics and the phone screens group by
}
export interface SettingsPatch {
  avatar?: string;
  categories?: Category[];
  timezone?: string;
  budgetPeriod?: { mode?: BudgetPeriodSetting["mode"]; startDay?: number; paycheckIncomeId?: string | null };
  showBy?: ShowBy;
}
export interface SpendingInput { amount: number; description: string; category: string; date: string; time: string; repeatRuleId?: string | null }
export interface Spending extends SpendingInput {
  id: string;
  planId?: string | null; // set when materialized from a plan
  planDate?: string | null; // the plan occurrence date it came from
}
export interface SpendingPage { spendings: Spending[]; nextCursor: string | null }
export const TRANSACTION_KINDS = ["expense", "income"] as const;
export type TransactionKind = typeof TRANSACTION_KINDS[number];
/** One real money movement. Expenses are spendings; income rows are written from income schedules. */
export interface Transaction {
  id: string;
  kind: TransactionKind;
  amount: number; // always > 0; the kind gives the direction
  description: string;
  category: string; // expense: a category id; income: the income source (Salary, Freelance, ...)
  date: string; // YYYY-MM-DD, the paid day
  time: string; // HH:mm
  planId?: string | null;
  planDate?: string | null;
  incomeId?: string | null; // the income schedule this payment came from; null once that schedule is deleted
  incomeDate?: string | null; // the nominal payday it came from
}
/** Editable fields of a transaction; the kind never changes. */
export interface TransactionInput { amount: number; description: string; category: string; date: string; time: string }
export interface TransactionPage { transactions: Transaction[]; nextCursor: string | null }
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
    showBy: "calendar_month",
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
