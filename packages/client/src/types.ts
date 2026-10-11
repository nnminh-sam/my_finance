export type Category = string;

export interface CategoryData {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface Spending {
  id: string;
  amount: number;
  description: string;
  category: Category;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
}

export interface IncomeEntryInput {
  month: string; // YYYY-MM
  amount: number;
  description: string;
}

export interface IncomeEntry extends IncomeEntryInput {
  id: string;
}

export type ViewMode = 'month' | 'week' | 'day' | 'profile' | 'analytics';

export interface UserSettings {
  income: number;

  theme: 'dark' | 'light';
  name: string;
  email: string;
  avatar: string;
  categories: CategoryData[];
}
