// The everyday budget behind the calendar's "over" flag (docs/mockups/calendar-spend-signal.html, direction C).
// Bills (rent, money for parents, subscriptions) come off the income first and never count against a day.
// A spending is a bill when its category is marked as one, or when it came from a sure plan. What is left,
// spread evenly over the period, is the budget each day is compared with.

export interface BudgetSpending { amount: number; date: string; category?: string; planId?: string | null }

/** What makes a spending a bill: sure plans and bill categories, by id. */
export interface BillRules { surePlanIds: ReadonlySet<string>; billCategories: ReadonlySet<string> }
export interface BudgetOccurrence { amount: number; sure: boolean; category?: string }

export type DayFlag = 'over' | 'bills' | null;

const cents = (amount: number) => Math.round(amount * 100);

/** A spending in a bill category, or one that came from a sure plan, is a bill, not everyday spending. */
export const isBill = (spending: Pick<BudgetSpending, 'planId' | 'category'>, rules: BillRules) =>
  (!!spending.category && rules.billCategories.has(spending.category)) || (!!spending.planId && rules.surePlanIds.has(spending.planId));

/**
 * Bills of a period: bill spendings already made, plus planned occurrences still to come that are sure or in a
 * bill category. `spendings` must already be limited to the period; `upcoming` holds only occurrences not yet real.
 */
export function periodBills(spendings: readonly BudgetSpending[], upcoming: readonly BudgetOccurrence[], rules: BillRules): number {
  const made = spendings.filter(spending => isBill(spending, rules)).reduce((sum, spending) => sum + cents(spending.amount), 0);
  const toCome = upcoming.filter(item => item.sure || (!!item.category && rules.billCategories.has(item.category))).reduce((sum, item) => sum + cents(item.amount), 0);
  return (made + toCome) / 100;
}

/** (income − bills) ÷ days, or null when there is no income or nothing left after bills. Fixed for the period. */
export function everydayBudget(income: number, bills: number, totalDays: number): number | null {
  if (!(totalDays > 0) || !(income > 0)) return null;
  const left = cents(income) - cents(bills);
  return left > 0 ? Math.floor(left / totalDays) / 100 : null;
}

/** Splits one day's spendings into bills and everyday spending. */
export function splitDay(spendings: readonly BudgetSpending[], rules: BillRules): { everyday: number; bills: number } {
  let everyday = 0, bills = 0;
  for (const spending of spendings) {
    if (isBill(spending, rules)) bills += cents(spending.amount);
    else everyday += cents(spending.amount);
  }
  return { everyday: everyday / 100, bills: bills / 100 };
}

/**
 * 'over' when everyday spending passed the budget, 'bills' when the day only paid bills, otherwise null.
 * Without a budget nothing is flagged, so a missing income never paints the month amber.
 */
export function dayFlag(day: { everyday: number; bills: number }, budget: number | null): DayFlag {
  if (budget !== null && cents(day.everyday) > cents(budget)) return 'over';
  if (day.everyday === 0 && day.bills > 0) return 'bills';
  return null;
}
