export interface Category { id: string; name: string; color: string; icon: string }
export interface FinanceSettings {
  income: number;

  avatar: string;
  categories: Category[];
}
export interface SpendingInput { amount: number; description: string; category: string; date: string; time: string }
export interface Spending extends SpendingInput { id: string }
export interface SpendingPage { spendings: Spending[]; nextCursor: string | null }
export interface IncomeEntryInput { month: string; amount: number; description: string }
export interface IncomeEntry extends IncomeEntryInput { id: string }
export interface IncomeEntryPage { incomeEntries: IncomeEntry[]; nextCursor: string | null }

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
