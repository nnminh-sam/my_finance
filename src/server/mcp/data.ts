import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { computeMonthlyAnalytics } from "../../lib/analytics";
import { countIncomeOccurrences, describeIncomeSchedule, getMonthIncome } from "../../lib/income";
import { describeRepeatFrequency, monthlyRepeatCost, repeatProgress } from "../../lib/repeatRules";
import {
  clampDelayDays,
  clampSalaryDay,
  defaultSalaryCycleConfig,
  getSalaryCycleForMonth,
  getSpendingsForSalaryCycle,
  parseCycleMonth,
  type SalaryCycleConfig,
} from "../../lib/salaryCycle";
import type { FinanceSettings, Income, RepeatRule, Spending } from "../finance/model";
import type { FinanceStore } from "../finance/store";

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

export function enrichRepeatRule(rule: RepeatRule, settings: FinanceSettings) {
  const category = settings.categories.find(c => c.id === rule.category);
  const progress = repeatProgress(rule);
  return {
    ...rule,
    categoryName: category?.name ?? rule.category,
    scheduleDescription: describeRepeatFrequency(rule),
    estimatedMonthlyCost: Math.round(monthlyRepeatCost(rule) * 100) / 100,
    progress,
  };
}

export function enrichIncome(income: Income, month?: string) {
  const schedule = describeIncomeSchedule(income);
  if (!month) {
    return { ...income, scheduleDescription: schedule };
  }
  const monthInfo = getMonthIncome(month, [income]);
  const item = monthInfo.items[0];
  return {
    ...income,
    scheduleDescription: schedule,
    monthOccurrences: item?.occurrences ?? 0,
    monthTotal: item?.total ?? 0,
  };
}

export async function buildMonthlyAnalyticsReport(
  store: FinanceStore,
  userId: string,
  month: string,
) {
  const [year, monthNum] = month.split("-").map(Number);
  const monthDate = new Date(year, monthNum - 1, 1);
  const sixMonthsAgo = format(startOfMonth(subMonths(monthDate, 5)), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(monthDate), "yyyy-MM-dd");

  const [settings, spendings, incomes] = await Promise.all([
    store.getSettings(userId),
    fetchAllSpendings(store, userId, sixMonthsAgo, monthEnd),
    fetchAllIncomes(store, userId),
  ]);

  const analytics = computeMonthlyAnalytics(monthDate, settings, spendings, incomes);
  const catMap = new Map(settings.categories.map(c => [c.id, c]));

  return {
    month,
    daysInMonth: analytics.daysInMonth,
    elapsedDays: analytics.elapsedDays,
    isCurrentMonth: analytics.isCurrentMonth,
    isFutureMonth: analytics.isFutureMonth,
    hasData: analytics.hasData,
    totalSpending: analytics.total,
    income: {
      total: analytics.income,
      recurring: analytics.recurringIncome,
      oneTime: analytics.oneTimeIncome,
    },
    netBalance: Math.round((analytics.income - analytics.total) * 100) / 100,
    projectedNetBalance: Math.round((analytics.income - analytics.projectedTotal) * 100) / 100,
    savingsRate: Math.round(analytics.savingsRate * 10000) / 10000,
    forecast: {
      projectedTotal: Math.round(analytics.projectedTotal * 100) / 100,
      projectedLow: Math.round(analytics.projectedLow * 100) / 100,
      projectedHigh: Math.round(analytics.projectedHigh * 100) / 100,
      dailyRate: Math.round(analytics.dailyRate * 100) / 100,
      r2: Math.round(analytics.r2 * 10000) / 10000,
    },
    descriptiveStats: {
      dailyMean: Math.round(analytics.dailyMean * 100) / 100,
      dailyMedian: Math.round(analytics.dailyMedian * 100) / 100,
      dailyStd: Math.round(analytics.dailyStd * 100) / 100,
      outlierThreshold: Number.isFinite(analytics.upperFence)
        ? Math.round(analytics.upperFence * 100) / 100
        : null,
    },
    transactions: {
      count: analytics.txCount,
      avgTicket: Math.round(analytics.avgTicket * 100) / 100,
      medianTicket: Math.round(analytics.medianTicket * 100) / 100,
      largest: analytics.largest,
      pareto80Share: Math.round(analytics.pareto80 * 10000) / 10000,
      gini: Math.round(analytics.gini * 10000) / 10000,
    },
    activity: {
      activeDays: analytics.activity.active,
      noSpendDays: analytics.activity.noSpend,
      currentNoSpendStreak: analytics.currentNoSpendStreak,
      longestNoSpendStreak: analytics.longestNoSpendStreak,
    },
    comparison: {
      prevSamePeriodTotal: analytics.prevSamePeriodTotal,
      prevFullMonthTotal: analytics.prevFullTotal,
      momChangeRatio: analytics.momChange !== null ? Math.round(analytics.momChange * 10000) / 10000 : null,
    },
    categories: analytics.categories.map(c => ({
      id: c.id,
      name: catMap.get(c.id)?.name ?? c.id,
      total: c.total,
      count: c.count,
      shareRatio: Math.round(c.share * 10000) / 10000,
      prevSamePeriodTotal: c.prevTotal,
      changeRatio: c.change !== null ? Math.round(c.change * 10000) / 10000 : null,
      avgTicket: Math.round(c.avgTicket * 100) / 100,
    })),
    anomalies: analytics.anomalies.map(a => ({
      date: format(a.date, "yyyy-MM-dd"),
      total: a.total,
      count: a.count,
      zScore: Math.round(a.zScore * 100) / 100,
    })),
    peakHour: analytics.peakHour,
    trend6Months: analytics.trend.map(t => ({
      month: format(t.date, "yyyy-MM"),
      label: t.label,
      total: t.total,
      isCurrent: t.isCurrent,
      isPartial: t.isPartial,
    })),
    insights: analytics.insights,
  };
}

export async function buildSalaryCycleReport(
  store: FinanceStore,
  userId: string,
  cycleMonth: string,
  options?: {
    salaryDay?: number;
    shiftWeekendToMonday?: boolean;
    includeNextPaydayInCycle?: boolean;
    delayDays?: number;
  },
) {
  const baseConfig: SalaryCycleConfig = {
    ...defaultSalaryCycleConfig(),
    salaryDay: options?.salaryDay !== undefined ? clampSalaryDay(options.salaryDay) : 5,
    shiftWeekendToMonday: options?.shiftWeekendToMonday ?? true,
    includeNextPaydayInCycle: options?.includeNextPaydayInCycle ?? true,
    monthDelays: options?.delayDays
      ? { [cycleMonth]: clampDelayDays(options.delayDays) }
      : {},
  };

  const monthDate = parseCycleMonth(cycleMonth);
  const cycle = getSalaryCycleForMonth(monthDate, baseConfig);
  const startDate = format(cycle.startDate, "yyyy-MM-dd");
  const endDate = format(cycle.endDate, "yyyy-MM-dd");

  const [settings, spendings, incomes] = await Promise.all([
    store.getSettings(userId),
    fetchAllSpendings(store, userId, startDate, endDate),
    fetchAllIncomes(store, userId),
  ]);

  const cycleSpendings = getSpendingsForSalaryCycle(cycle, spendings);
  const totalSpending = Math.round(cycleSpendings.reduce((s, item) => s + item.amount, 0) * 100) / 100;
  const monthIncome = getMonthIncome(cycle.cycleMonth, incomes);
  const leftover = Math.round((monthIncome.totalIncome - totalSpending) * 100) / 100;

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const totalDays = cycle.days.length;
  const elapsedDays = todayStr < startDate
    ? 0
    : todayStr > endDate
      ? totalDays
      : cycle.days.filter(d => format(d, "yyyy-MM-dd") <= todayStr).length;
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const dailyBurnRate = elapsedDays > 0 ? Math.round((totalSpending / elapsedDays) * 100) / 100 : 0;
  const safeDailyBudgetRemaining = remainingDays > 0 && leftover > 0
    ? Math.round((leftover / remainingDays) * 100) / 100
    : 0;

  const catMap = new Map(settings.categories.map(c => [c.id, c]));
  const byCategory = new Map<string, { total: number; count: number }>();
  const byDate = new Map<string, number>();

  for (const item of cycleSpendings) {
    const c = byCategory.get(item.category) ?? { total: 0, count: 0 };
    c.total = Math.round((c.total + item.amount) * 100) / 100;
    c.count += 1;
    byCategory.set(item.category, c);
    byDate.set(item.date, Math.round(((byDate.get(item.date) ?? 0) + item.amount) * 100) / 100);
  }

  let peakDay: { date: string; total: number } | null = null;
  for (const [date, total] of byDate.entries()) {
    if (!peakDay || total > peakDay.total) {
      peakDay = { date, total };
    }
  }

  const categories = [...byCategory.entries()]
    .map(([id, c]) => ({
      id,
      name: catMap.get(id)?.name ?? id,
      total: c.total,
      count: c.count,
      shareRatio: totalSpending > 0 ? Math.round((c.total / totalSpending) * 10000) / 10000 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    cycleMonth: cycle.cycleMonth,
    config: {
      salaryDay: baseConfig.salaryDay,
      shiftWeekendToMonday: baseConfig.shiftWeekendToMonday,
      includeNextPaydayInCycle: baseConfig.includeNextPaydayInCycle,
      delayDays: cycle.manualDelayDays,
    },
    dates: {
      nominalPayday: format(cycle.nominalStartDate, "yyyy-MM-dd"),
      startDate,
      endDate,
      nextPayday: format(cycle.nextStartDate, "yyyy-MM-dd"),
      weekendShiftDays: cycle.weekendShiftDays,
      manualDelayDays: cycle.manualDelayDays,
      totalDays,
      elapsedDays,
      remainingDays,
    },
    income: {
      total: monthIncome.totalIncome,
      recurring: monthIncome.recurringIncome,
      oneTime: monthIncome.oneTimeIncome,
      sources: monthIncome.items.map(i => ({
        id: i.income.id,
        source: i.income.source,
        name: i.income.name,
        occurrences: i.occurrences,
        total: i.total,
      })),
    },
    spending: {
      total: totalSpending,
      transactionCount: cycleSpendings.length,
      dailyBurnRate,
      peakDay,
    },
    leftover,
    safeDailyBudgetRemaining,
    categories,
  };
}

export async function buildDateRangeSummary(
  store: FinanceStore,
  userId: string,
  startDate: string,
  endDate: string,
) {
  const [settings, spendings, incomes] = await Promise.all([
    store.getSettings(userId),
    fetchAllSpendings(store, userId, startDate, endDate),
    fetchAllIncomes(store, userId),
  ]);

  const totalSpending = Math.round(spendings.reduce((s, item) => s + item.amount, 0) * 100) / 100;
  let incomeCents = 0;
  const incomeBreakdown: Array<{ id: string; source: string; name: string; occurrences: number; total: number }> = [];
  for (const inc of incomes) {
    const occurrences = countIncomeOccurrences(inc, startDate, endDate);
    if (occurrences > 0) {
      const cents = Math.round(inc.amount * 100) * occurrences;
      incomeCents += cents;
      incomeBreakdown.push({
        id: inc.id,
        source: inc.source,
        name: inc.name,
        occurrences,
        total: cents / 100,
      });
    }
  }
  const totalIncome = incomeCents / 100;

  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const totalDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
  const dailyAverage = Math.round((totalSpending / totalDays) * 100) / 100;

  const catMap = new Map(settings.categories.map(c => [c.id, c]));
  const byCategory = new Map<string, { total: number; count: number }>();
  for (const item of spendings) {
    const c = byCategory.get(item.category) ?? { total: 0, count: 0 };
    c.total = Math.round((c.total + item.amount) * 100) / 100;
    c.count += 1;
    byCategory.set(item.category, c);
  }

  const categories = [...byCategory.entries()]
    .map(([id, c]) => ({
      id,
      name: catMap.get(id)?.name ?? id,
      total: c.total,
      count: c.count,
      shareRatio: totalSpending > 0 ? Math.round((c.total / totalSpending) * 10000) / 10000 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const topSpendings = [...spendings]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  return {
    startDate,
    endDate,
    totalDays,
    totalSpending,
    totalIncome,
    netCashflow: Math.round((totalIncome - totalSpending) * 100) / 100,
    transactionCount: spendings.length,
    dailyAverage,
    categories,
    incomeBreakdown,
    topSpendings,
  };
}
