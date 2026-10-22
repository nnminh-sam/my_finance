import type { RepeatRule } from '../types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_PER_MONTH = 365.25 / 12;

type Schedule = Pick<RepeatRule, 'frequency' | 'interval' | 'daysOfWeek'>;

export function describeRepeatFrequency(rule: Schedule): string {
  const interval = Math.max(1, rule.interval ?? 1);
  switch (rule.frequency) {
    case 'daily':
      return interval > 1 ? `Every ${interval} days` : 'Daily';
    case 'weekdays':
      return 'Weekdays';
    case 'weekly': {
      const days = (rule.daysOfWeek ?? []).map(day => DAY_NAMES[day]).join(', ');
      const base = interval > 1 ? `Every ${interval} weeks` : 'Weekly';
      return days ? `${base} · ${days}` : base;
    }
    case 'monthly':
      return interval > 1 ? `Every ${interval} months` : 'Monthly';
    default:
      return rule.frequency;
  }
}

/** Average number of entries a rule creates per month, ignoring its start and end. */
export function repeatsPerMonth(rule: Schedule): number {
  const interval = Math.max(1, rule.interval ?? 1);
  switch (rule.frequency) {
    case 'daily':
      return DAYS_PER_MONTH / interval;
    case 'weekdays':
      return DAYS_PER_MONTH * 5 / 7;
    case 'weekly':
      return Math.max(1, rule.daysOfWeek?.length ?? 0) * DAYS_PER_MONTH / 7 / interval;
    case 'monthly':
      return 1 / interval;
    default:
      return 0;
  }
}

export function monthlyRepeatCost(rule: Schedule & Pick<RepeatRule, 'amount'>): number {
  return Math.round(rule.amount * repeatsPerMonth(rule));
}

/** Progress for rules with a fixed number of repeats; null for open-ended or date-bounded rules. */
export function repeatProgress(rule: Pick<RepeatRule, 'endType' | 'occurrencesCreated' | 'totalOccurrences'>): { done: number; total: number } | null {
  if (rule.endType !== 'occurrences') return null;
  const total = Math.max(1, rule.totalOccurrences ?? 100);
  return { done: Math.min(rule.occurrencesCreated, total), total };
}
