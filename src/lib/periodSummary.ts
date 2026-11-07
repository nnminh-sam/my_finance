// Plan summary of one budget period: what is paid in, what is already spent, and what is still
// planned. Pure, shared by the server (HTTP and MCP) and, for the types, the browser.

import { incomePaydays, type IncomeSchedule } from './income';
import type { BudgetPeriod } from './periods';
import { projectPlans, type PlanLike, type PlanOccurrence } from './plans';

export interface PeriodPayment {
  incomeId: string;
  source: string;
  name: string;
  date: string; // paid date (after the weekend shift)
  amount: number;
}

export interface PlanPeriodSummary {
  period: BudgetPeriod;
  today: string; // YYYY-MM-DD in the user's time zone
  payments: PeriodPayment[];
  income: number; // every payment in the period, including those still to come
  spent: number; // real spendings dated in the period
  committed: number; // planned occurrences marked sure
  tentative: number; // planned occurrences that are estimates
  left: number; // income - spent - committed - tentative
  occurrences: PlanOccurrence[];
}

export type SummaryIncome = IncomeSchedule & { id: string; source: string; name: string; amount: number };
export interface SummarySpending { amount: number; date: string; planId?: string | null; planDate?: string | null }

const cents = (amount: number) => Math.round(amount * 100);

export function summarizePlanPeriod(input: {
  period: BudgetPeriod;
  today: string;
  incomes: readonly SummaryIncome[];
  spendings: readonly SummarySpending[];
  plans: (PlanLike & { materializedThrough: string | null })[];
}): PlanPeriodSummary {
  const { period } = input;
  const payments: PeriodPayment[] = [];
  for (const income of input.incomes) {
    for (const payday of incomePaydays(income, period.start, period.end)) {
      payments.push({ incomeId: income.id, source: income.source, name: income.name, date: payday.paid, amount: income.amount });
    }
  }
  payments.sort((a, b) => a.date.localeCompare(b.date));
  const incomeCents = payments.reduce((sum, payment) => sum + cents(payment.amount), 0);

  const inPeriod = input.spendings.filter(spending => spending.date >= period.start && spending.date <= period.end);
  const spentCents = inPeriod.reduce((sum, spending) => sum + cents(spending.amount), 0);

  // An occurrence that already became a real spending is in `spent`, so it is left out of the projection.
  const realKeys = new Set(input.spendings.flatMap(spending => spending.planId && spending.planDate ? [`${spending.planId}|${spending.planDate}`] : []));
  const occurrences = projectPlans(input.plans, period.start, period.end, realKeys);
  const committedCents = occurrences.filter(item => item.sure).reduce((sum, item) => sum + cents(item.amount), 0);
  const tentativeCents = occurrences.filter(item => !item.sure).reduce((sum, item) => sum + cents(item.amount), 0);

  return {
    period,
    today: input.today,
    payments,
    income: incomeCents / 100,
    spent: spentCents / 100,
    committed: committedCents / 100,
    tentative: tentativeCents / 100,
    left: (incomeCents - spentCents - committedCents - tentativeCents) / 100,
    occurrences,
  };
}
