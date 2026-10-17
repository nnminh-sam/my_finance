export interface Category { id: string; name: string; color: string; icon: string }
export interface FinanceSettings {
  income: number;

  avatar: string;
  categories: Category[];
}
export interface SpendingInput { amount: number; description: string; category: string; date: string; time: string; repeatRuleId?: string | null }
export interface Spending extends SpendingInput { id: string }
export interface SpendingPage { spendings: Spending[]; nextCursor: string | null }
export interface IncomeEntryInput { month: string; amount: number; description: string }
export interface IncomeEntry extends IncomeEntryInput { id: string }
export interface IncomeEntryPage { incomeEntries: IncomeEntry[]; nextCursor: string | null }

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

export const CATEGORY_ICONS = new Set([
  "Utensils", "Car", "Film", "ShoppingBag", "Receipt", "CircleDollarSign",
  "Coffee", "Home", "Heart", "Briefcase", "Gift", "Phone",
]);

export function defaultFinanceSettings(): FinanceSettings {
  return {
    income: 0, avatar: "",
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
