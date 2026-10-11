import {
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isAfter,
  isSameMonth,
  startOfDay,
  startOfMonth,
  subMonths,
} from 'date-fns';
import type { IncomeEntry, Spending, UserSettings } from './types';
import { getMonthIncome, incomeMonth } from './income';

/* ------------------------------------------------------------------ */
/* Statistical helpers                                                 */
/* ------------------------------------------------------------------ */

export const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
export const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);

export const quantile = (a: number[], q: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
};

export const stdDev = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1));
};

/** Ordinary least squares fit y = slope * x + intercept. */
export const linearRegression = (xs: number[], ys: number[]) => {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den ? num / den : 0;
  const intercept = my - slope * mx;
  const ssTot = sum(ys.map((y) => (y - my) ** 2));
  const ssRes = sum(ys.map((y, i) => (y - (slope * xs[i] + intercept)) ** 2));
  return { slope, intercept, r2: ssTot ? 1 - ssRes / ssTot : 1 };
};

/** Gini coefficient (0 = perfectly even, 1 = fully concentrated). */
export const gini = (values: number[]) => {
  const s = values.filter((v) => v > 0).sort((a, b) => a - b);
  const n = s.length;
  const total = sum(s);
  if (n < 2 || total === 0) return 0;
  let weighted = 0;
  s.forEach((v, i) => (weighted += (i + 1) * v));
  return (2 * weighted) / (n * total) - (n + 1) / n;
};

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export const fmtVND = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} ₫`;

export const fmtCompact = (n: number) => {
  const a = Math.abs(n);
  const trim = (v: number) => v.toFixed(1).replace(/\.0$/, '');
  if (a >= 1e9) return `${trim(n / 1e9)}B`;
  if (a >= 1e6) return `${trim(n / 1e6)}M`;
  if (a >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
};

export const fmtPct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface DailyPoint {
  date: Date;
  day: number; // 1-based day of month
  total: number;
  count: number;
  cumulative: number;
  ma7: number | null;
  zScore: number;
  isAnomaly: boolean;
  isFuture: boolean;
}

export interface ProjectionPoint {
  index: number; // 0-based day index
  value: number;
  low: number;
  high: number;
}

export interface CategoryStat {
  id: string;
  total: number;
  count: number;
  share: number;
  prevTotal: number; // same period previous month
  change: number | null; // relative change, null when no baseline
  avgTicket: number;
}

export interface MonthTrendPoint {
  label: string;
  date: Date;
  total: number;
  isCurrent: boolean;
  isPartial: boolean;
}

export type InsightTone = 'positive' | 'warning' | 'danger' | 'info';
export interface Insight {
  tone: InsightTone;
  title: string;
  detail: string;
}

export interface MonthlyAnalytics {
  monthStart: Date;
  daysInMonth: number;
  elapsedDays: number;
  isCurrentMonth: boolean;
  isFutureMonth: boolean;
  hasData: boolean;

  spendings: Spending[];
  total: number;
  daily: DailyPoint[];

  // descriptive stats (over elapsed days)
  dailyMean: number;
  dailyMedian: number;
  dailyStd: number;
  upperFence: number;
  anomalies: DailyPoint[];

  // forecast
  projectedTotal: number;
  projectedLow: number;
  projectedHigh: number;
  projection: ProjectionPoint[];
  dailyRate: number;
  r2: number;

  // income reference and spending activity (over elapsed days)
  income: number;
  baseIncome: number;
  additionalIncome: number;
  savingsRate: number; // based on projection; meaningful only when income > 0
  activity: { noSpend: number; active: number };
  longestNoSpendStreak: number;
  currentNoSpendStreak: number;

  // comparisons
  prevSamePeriodTotal: number;
  prevFullTotal: number;
  momChange: number | null;

  // breakdowns
  categories: CategoryStat[];
  weekday: { avg: number; total: number; days: number }[];
  punchCard: { amount: number; count: number }[][]; // [weekday][hour]
  peakHour: number | null;

  // transactions
  txCount: number;
  avgTicket: number;
  medianTicket: number;
  largest: Spending | null;

  // concentration
  pareto: { x: number; y: number }[];
  pareto80: number; // share of transactions making up 80% of spend
  gini: number;

  trend: MonthTrendPoint[];
  insights: Insight[];
}

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

export const getSpendingsForMonth = (date: Date, upToDay: number | undefined, spendings: Spending[]): Spending[] => {
  const prefix = format(date, 'yyyy-MM');
  return spendings.filter(
    (s) => s.date.startsWith(prefix) && (upToDay === undefined || Number(s.date.slice(8, 10)) <= upToDay),
  );
};

const weekdayIndex = (d: Date) => (getDay(d) + 6) % 7; // Monday = 0

/* ------------------------------------------------------------------ */
/* Main computation                                                    */
/* ------------------------------------------------------------------ */

export const computeMonthlyAnalytics = (
  monthDate: Date,
  settings: Pick<UserSettings, 'income' | 'categories'>,
  allSpendings: Spending[],
  incomeEntries: readonly IncomeEntry[] = [],
): MonthlyAnalytics => {
  const today = startOfDay(new Date());
  const monthStart = startOfMonth(monthDate);
  const days = eachDayOfInterval({ start: monthStart, end: endOfMonth(monthStart) });
  const daysInMonth = days.length;
  const isCurrentMonth = isSameMonth(monthStart, today);
  const isFutureMonth = isAfter(monthStart, today);
  const elapsedDays = isFutureMonth ? 0 : isCurrentMonth ? today.getDate() : daysInMonth;
  const { baseIncome, additionalIncome, totalIncome: income } = getMonthIncome(
    settings.income, incomeMonth(monthStart), incomeEntries,
  );

  const spendings = getSpendingsForMonth(monthStart, undefined, allSpendings);
  const total = sum(spendings.map((s) => s.amount));

  // ---- Daily series ----------------------------------------------------
  const byDate = new Map<string, Spending[]>();
  spendings.forEach((s) => {
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  });

  let running = 0;
  const daily: DailyPoint[] = days.map((date, i) => {
    const items = byDate.get(format(date, 'yyyy-MM-dd')) ?? [];
    const dayTotal = sum(items.map((s) => s.amount));
    running += dayTotal;
    return {
      date,
      day: i + 1,
      total: dayTotal,
      count: items.length,
      cumulative: running,
      ma7: null,
      zScore: 0,
      isAnomaly: false,
      isFuture: i >= elapsedDays,
    };
  });

  const elapsed = daily.slice(0, elapsedDays);
  const elapsedTotals = elapsed.map((d) => d.total);

  // 7-day trailing moving average (smooths day-to-day noise)
  elapsed.forEach((d, i) => {
    const window = elapsedTotals.slice(Math.max(0, i - 6), i + 1);
    d.ma7 = mean(window);
  });

  const dailyMean = elapsedDays ? sum(elapsedTotals) / elapsedDays : 0;
  const dailyMedian = quantile(elapsedTotals, 0.5);
  const dailyStd = stdDev(elapsedTotals);

  // Anomaly detection: Tukey's fences on spending days (robust to skew)
  const activeTotals = elapsedTotals.filter((t) => t > 0);
  const q1 = quantile(activeTotals, 0.25);
  const q3 = quantile(activeTotals, 0.75);
  const upperFence = activeTotals.length >= 4 ? q3 + 1.5 * (q3 - q1) : Infinity;
  elapsed.forEach((d) => {
    d.zScore = dailyStd ? (d.total - dailyMean) / dailyStd : 0;
    d.isAnomaly = d.total > upperFence;
  });
  const anomalies = elapsed.filter((d) => d.isAnomaly).sort((a, b) => b.total - a.total);

  // ---- Forecast: OLS on the cumulative curve + 95% interval -----------
  const spentSoFar = elapsed.length ? elapsed[elapsed.length - 1].cumulative : 0;
  const remaining = daysInMonth - elapsedDays;
  const reg = linearRegression(
    elapsed.map((d) => d.day),
    elapsed.map((d) => d.cumulative),
  );
  const dailyRate = elapsedDays >= 3 ? Math.max(reg.slope, 0) : dailyMean;
  const projection: ProjectionPoint[] = [];
  if (elapsedDays > 0 && remaining > 0) {
    for (let k = 0; k <= remaining; k++) {
      const value = spentSoFar + dailyRate * k;
      // Daily spend modelled as i.i.d. → uncertainty grows with √k
      const spread = 1.96 * dailyStd * Math.sqrt(k);
      projection.push({
        index: elapsedDays - 1 + k,
        value,
        low: Math.max(spentSoFar, value - spread),
        high: value + spread,
      });
    }
  }
  const last = projection[projection.length - 1];
  const projectedTotal = last ? last.value : total;
  const projectedLow = last ? last.low : total;
  const projectedHigh = last ? last.high : total;

  // ---- Spending activity and no-spend streaks ----------------------------
  const activity = { noSpend: 0, active: 0 };
  let longestNoSpendStreak = 0;
  let streak = 0;
  elapsed.forEach((d) => {
    if (d.total === 0) {
      activity.noSpend++;
      streak++;
      longestNoSpendStreak = Math.max(longestNoSpendStreak, streak);
    } else {
      activity.active++;
      streak = 0;
    }
  });
  const currentNoSpendStreak = streak;

  // ---- Month-over-month (same period, so partial months compare fairly) --
  const prevMonth = subMonths(monthStart, 1);
  const prevSame = getSpendingsForMonth(prevMonth, elapsedDays || daysInMonth, allSpendings);
  const prevSamePeriodTotal = sum(prevSame.map((s) => s.amount));
  const prevFullTotal = sum(getSpendingsForMonth(prevMonth, undefined, allSpendings).map((s) => s.amount));
  const momChange = prevSamePeriodTotal > 0 ? total / prevSamePeriodTotal - 1 : null;

  // ---- Categories --------------------------------------------------------
  const catMap = new Map<string, { total: number; count: number }>();
  spendings.forEach((s) => {
    const c = catMap.get(s.category) ?? { total: 0, count: 0 };
    c.total += s.amount;
    c.count++;
    catMap.set(s.category, c);
  });
  const prevCat = new Map<string, number>();
  prevSame.forEach((s) => prevCat.set(s.category, (prevCat.get(s.category) ?? 0) + s.amount));

  const categories: CategoryStat[] = [...catMap.entries()]
    .map(([id, c]) => {
      const prevTotal = prevCat.get(id) ?? 0;
      return {
        id,
        total: c.total,
        count: c.count,
        share: total ? c.total / total : 0,
        prevTotal,
        change: prevTotal > 0 ? c.total / prevTotal - 1 : null,
        avgTicket: c.total / c.count,
      };
    })
    .sort((a, b) => b.total - a.total);

  // ---- Weekday pattern ---------------------------------------------------
  const weekday = WEEKDAYS.map(() => ({ avg: 0, total: 0, days: 0 }));
  elapsed.forEach((d) => {
    const w = weekday[weekdayIndex(d.date)];
    w.total += d.total;
    w.days++;
  });
  weekday.forEach((w) => (w.avg = w.days ? w.total / w.days : 0));

  // ---- Time-of-day punch card -------------------------------------------
  const punchCard = WEEKDAYS.map(() => Array.from({ length: 24 }, () => ({ amount: 0, count: 0 })));
  const hourTotals = Array(24).fill(0) as number[];
  spendings.forEach((s) => {
    const hour = Number(s.time.slice(0, 2));
    const cell = punchCard[weekdayIndex(new Date(`${s.date}T00:00:00`))][hour];
    cell.amount += s.amount;
    cell.count++;
    hourTotals[hour] += s.amount;
  });
  const peakHourVal = Math.max(...hourTotals);
  const peakHour = peakHourVal > 0 ? hourTotals.indexOf(peakHourVal) : null;

  // ---- Transactions & concentration -------------------------------------
  const amounts = spendings.map((s) => s.amount);
  const sortedDesc = [...amounts].sort((a, b) => b - a);
  const pareto: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  let acc = 0;
  let pareto80 = 0;
  sortedDesc.forEach((a, i) => {
    acc += a;
    const y = acc / total;
    pareto.push({ x: (i + 1) / sortedDesc.length, y });
    if (!pareto80 && y >= 0.8) pareto80 = (i + 1) / sortedDesc.length;
  });
  const largest = spendings.reduce<Spending | null>((m, s) => (!m || s.amount > m.amount ? s : m), null);

  // ---- 6-month trend -----------------------------------------------------
  const trend: MonthTrendPoint[] = [];
  for (let k = 5; k >= 0; k--) {
    const d = subMonths(monthStart, k);
    trend.push({
      label: format(d, 'MMM'),
      date: d,
      total: sum(getSpendingsForMonth(d, undefined, allSpendings).map((s) => s.amount)),
      isCurrent: k === 0,
      isPartial: k === 0 && remaining > 0,
    });
  }


  const savingsRate = income > 0 ? (income - projectedTotal) / income : 0;

  const result: MonthlyAnalytics = {
    monthStart,
    daysInMonth,
    elapsedDays,
    isCurrentMonth,
    isFutureMonth,
    hasData: spendings.length > 0,
    spendings,
    total,
    daily,
    dailyMean,
    dailyMedian,
    dailyStd,
    upperFence,
    anomalies,
    projectedTotal,
    projectedLow,
    projectedHigh,
    projection,
    dailyRate,
    r2: reg.r2,
    income,
    baseIncome,
    additionalIncome,
    savingsRate,
    activity,
    longestNoSpendStreak,
    currentNoSpendStreak,
    prevSamePeriodTotal,
    prevFullTotal,
    momChange,
    categories,
    weekday,
    punchCard,
    peakHour,
    txCount: spendings.length,
    avgTicket: mean(amounts),
    medianTicket: quantile(amounts, 0.5),
    largest,
    pareto,
    pareto80,
    gini: gini(amounts),
    trend,
    insights: [],
  };
  result.insights = buildInsights(result, settings);
  return result;
};

/* ------------------------------------------------------------------ */
/* Natural-language insights                                           */
/* ------------------------------------------------------------------ */

const buildInsights = (
  a: MonthlyAnalytics,
  settings: Pick<UserSettings, 'categories'>,
): Insight[] => {
  if (!a.hasData) return [];
  const out: Insight[] = [];
  const catName = (id: string) => settings.categories?.find((c) => c.id === id)?.name ?? id;
  const partial = a.elapsedDays < a.daysInMonth;

  // Forecast vs monthly income, only when income is set
  if (partial && a.income > 0) {
    if (a.projectedTotal > a.income) {
      out.push({
        tone: 'danger',
        title: 'On pace to overspend your income',
        detail: `At ${fmtCompact(a.dailyRate)}/day you'll reach ~${fmtCompact(a.projectedTotal)}, ${fmtCompact(
          a.projectedTotal - a.income,
        )} over income.`,
      });
    } else {
      out.push({
        tone: 'positive',
        title: 'Projected spending within monthly income',
        detail: `Projected ${fmtCompact(a.projectedTotal)} vs ${fmtCompact(a.income)} monthly income.`,
      });
    }
  }

  // Month over month
  if (a.momChange !== null && Math.abs(a.momChange) >= 0.05) {
    const up = a.momChange > 0;
    out.push({
      tone: up ? 'warning' : 'positive',
      title: `${up ? 'Up' : 'Down'} ${fmtPct(Math.abs(a.momChange))} vs last month`,
      detail: `Compared over the same ${a.elapsedDays} days: ${fmtCompact(a.total)} vs ${fmtCompact(a.prevSamePeriodTotal)}.`,
    });
  }

  // Biggest category mover
  const movers = a.categories
    .map((c) => ({ ...c, delta: c.total - c.prevTotal }))
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  if (movers[0] && Math.abs(movers[0].delta) > 0 && a.prevSamePeriodTotal > 0) {
    const m = movers[0];
    out.push({
      tone: m.delta > 0 ? 'warning' : 'positive',
      title: `${catName(m.id)} ${m.delta > 0 ? 'increased' : 'decreased'} the most`,
      detail: `${m.delta > 0 ? '+' : '−'}${fmtCompact(Math.abs(m.delta))} vs the same period last month.`,
    });
  }

  // Dominant category
  if (a.categories[0]) {
    out.push({
      tone: 'info',
      title: `${catName(a.categories[0].id)} is your largest category`,
      detail: `${fmtPct(a.categories[0].share)} of spending across ${a.categories[0].count} transactions.`,
    });
  }

  // Weekday pattern
  const withDays = a.weekday.map((w, i) => ({ ...w, i })).filter((w) => w.days > 0);
  if (withDays.length >= 5) {
    const peak = withDays.reduce((m, w) => (w.avg > m.avg ? w : m));
    const overall = mean(withDays.map((w) => w.avg));
    if (overall > 0 && peak.avg / overall >= 1.15) {
      out.push({
        tone: 'info',
        title: `${WEEKDAYS_LONG[peak.i]}s are your priciest day`,
        detail: `Averaging ${fmtCompact(peak.avg)} — ${(peak.avg / overall).toFixed(1)}× your typical day.`,
      });
    }
  }

  // Anomalies
  if (a.anomalies.length) {
    const top = a.anomalies[0];
    out.push({
      tone: 'warning',
      title: `${a.anomalies.length} unusual spending day${a.anomalies.length > 1 ? 's' : ''}`,
      detail: `Largest on ${format(top.date, 'MMM d')} at ${fmtCompact(top.total)} (above the ${fmtCompact(
        a.upperFence,
      )} outlier threshold).`,
    });
  }

  // Concentration
  if (a.txCount >= 10 && a.pareto80 > 0) {
    out.push({
      tone: 'info',
      title: `${fmtPct(a.pareto80)} of purchases drive 80% of spend`,
      detail:
        a.pareto80 <= 0.4
          ? 'Spending is concentrated — focus on the few big-ticket items to save the most.'
          : 'Spending is fairly spread out — small habits add up here.',
    });
  }

  // No-spend streak
  if (a.currentNoSpendStreak >= 3) {
    out.push({
      tone: 'info',
      title: `${a.currentNoSpendStreak}-day no-spend streak`,
      detail: `Longest this month: ${a.longestNoSpendStreak} consecutive days with no recorded spending.`,
    });
  }

  return out;
};
