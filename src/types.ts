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
  repeatRuleId?: string | null;
}

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

export interface IncomeInput {
  source: string; // e.g. Salary, Freelance, Gift
  name: string; // e.g. employer or client; may be empty
  amount: number; // paid per occurrence
  frequency: IncomeFrequency;
  startDate: string; // YYYY-MM-DD; the payment date for one-time income
  endDate: string | null; // YYYY-MM-DD inclusive; null = no end (always null for one-time income)
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
}
