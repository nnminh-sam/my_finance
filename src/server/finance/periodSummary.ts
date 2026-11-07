import { periodOf, type BudgetPeriod, type BudgetPeriodSetting } from "../../lib/periods";
import { summarizePlanPeriod, type PlanPeriodSummary } from "../../lib/periodSummary";
import { localNowStamp } from "../../lib/plans";
import type { Income, Spending } from "./model";
import type { FinanceStore } from "./store";

export async function fetchAllSpendings(
  store: FinanceStore,
  userId: string,
  startDate?: string,
  endDate?: string,
): Promise<Spending[]> {
  const results: Spending[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  while (results.length < 10_000) {
    const page = startDate || endDate
      ? await store.listSpendings(userId, 500, cursor, startDate, endDate)
      : await store.listSpendings(userId, 500, cursor);
    results.push(...page.spendings);
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) break;
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return results;
}

export async function fetchAllIncomes(store: FinanceStore, userId: string): Promise<Income[]> {
  const results: Income[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  while (results.length < 5_000) {
    const page = await store.listIncomes(userId, 500, cursor);
    results.push(...page.incomes);
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) break;
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return results;
}

/** The plan summary of the budget period containing `date` (default: today in the user's time zone). */
export async function loadPlanPeriodSummary(store: FinanceStore, userId: string, date?: string): Promise<PlanPeriodSummary> {
  const [settings, incomes] = await Promise.all([store.getSettings(userId), fetchAllIncomes(store, userId)]);
  const today = localNowStamp(settings.timezone).slice(0, 10);
  const period = periodOf(settings.budgetPeriod, incomes, date ?? today);
  // Reading spendings materializes due plan occurrences first, so plans are listed after them.
  const spendings = await fetchAllSpendings(store, userId, period.start, period.end);
  // An occurrence marked done early is dated before the period but belongs to a plan date inside it.
  const linked = await store.listPlanSpendings(userId, period.start, period.end);
  const known = new Set(spendings.map(spending => spending.id));
  const plans = await store.listPlans(userId);
  return summarizePlanPeriod({ period, today, incomes, spendings: [...spendings, ...linked.filter(spending => !known.has(spending.id))], plans });
}

/** The budget period setting and the period containing today, for the MCP tool and resource. */
export async function loadBudgetPeriod(store: FinanceStore, userId: string): Promise<{ setting: BudgetPeriodSetting; today: string; period: BudgetPeriod }> {
  const [settings, incomes] = await Promise.all([store.getSettings(userId), fetchAllIncomes(store, userId)]);
  const today = localNowStamp(settings.timezone).slice(0, 10);
  return { setting: settings.budgetPeriod, today, period: periodOf(settings.budgetPeriod, incomes, today) };
}
