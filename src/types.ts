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
