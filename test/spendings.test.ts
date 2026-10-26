import assert from 'node:assert/strict';
import test from 'node:test';
import { getSpendingsForDate, getTopSpendingsForDate, getTotalForDate, formatCompactSpending, sanitizeMoneyInput, formatMoneyInputDisplay } from '../src/lib/spendings';
import { computeMonthlyAnalytics, getSpendingsForMonth } from '../src/lib/analytics';
import type { IncomeEntry, Spending } from '../src/types';

const settings = {
  income: 10000,

  categories: [
    { id: 'food', name: 'Food', color: '#123456', icon: 'Utensils' },
    { id: 'travel', name: 'Travel', color: '#654321', icon: 'Bus' },
  ],
};

function spending(id: string, date: string, time: string, amount: number, category = 'food'): Spending {
  return { id, date, time, amount, category, description: id };
}

const lunch = spending('jan-lunch', '2020-01-02', '12:30', 300);
const commute = spending('jan-commute', '2020-01-02', '08:15', 200, 'travel');
const dinner = spending('jan-dinner', '2020-01-15', '19:00', 100);
const previousFood = spending('dec-food', '2019-12-02', '12:00', 200);
const previousTravel = spending('dec-travel', '2019-12-31', '09:00', 100, 'travel');
const november = spending('nov-food', '2019-11-05', '10:00', 50);
const nextMonth = spending('feb-food', '2020-02-02', '12:30', 999);
const outsideTrend = spending('june-food', '2019-06-02', '12:30', 777);
const records = [lunch, nextMonth, previousTravel, dinner, commute, november, previousFood, outsideTrend];

function snapshot(values: Spending[]) {
  return values.map(value => ({ ...value }));
}

test('date helpers use only supplied records and sort matching spendings by time without mutation', () => {
  const before = snapshot(records);
  // Local noon avoids UTC conversion changing which calendar day is selected.
  const date = new Date(2020, 0, 2, 12);
  assert.deepEqual(getSpendingsForDate(date, records), [commute, lunch]);
  assert.equal(getTotalForDate(date, records), 500);
  assert.deepEqual(getTopSpendingsForDate(date, 1, records), [lunch]);
  assert.deepEqual(getTopSpendingsForDate(date, 10, records), [lunch, commute]);
  assert.deepEqual(records, before);
});

test('date helpers return empty results and zero totals for empty or nonmatching data', () => {
  const date = new Date(2020, 0, 3, 12);
  for (const values of [[], records]) {
    assert.deepEqual(getSpendingsForDate(date, values), []);
    assert.equal(getTotalForDate(date, values), 0);
    assert.deepEqual(getTopSpendingsForDate(date, 3, values), []);
  }
});

test('top spendings clamps zero and negative counts to an empty result', () => {
  const date = new Date(2020, 0, 2, 12);
  assert.deepEqual(getTopSpendingsForDate(date, 0, records), []);
  assert.deepEqual(getTopSpendingsForDate(date, -1, records), []);
});

test('month filtering respects year, month, and inclusive day cutoffs', () => {
  const before = snapshot(records);
  const january = new Date(2020, 0, 20, 12);
  const sameMonthOtherYear = spending('other-year', '2019-01-02', '08:00', 9999);
  const values = [...records, sameMonthOtherYear];
  assert.deepEqual(getSpendingsForMonth(january, undefined, values), [lunch, dinner, commute]);
  assert.deepEqual(getSpendingsForMonth(january, 2, values), [lunch, commute]);
  assert.deepEqual(getSpendingsForMonth(january, 15, values), [lunch, dinner, commute]);
  assert.deepEqual(getSpendingsForMonth(january, 1, values), []);
  assert.deepEqual(getSpendingsForMonth(january, 0, values), []);
  assert.deepEqual(getSpendingsForMonth(january, undefined, []), []);
  assert.deepEqual(records, before);
});

test('empty monthly analytics have no data, transactions, generated spendings, or spending totals', () => {
  const result = computeMonthlyAnalytics(new Date(2020, 0, 15, 12), settings, []);
  assert.equal(result.hasData, false);
  assert.deepEqual(result.spendings, []);
  assert.equal(result.total, 0);
  assert.equal(result.txCount, 0);
  assert.equal(result.avgTicket, 0);
  assert.equal(result.medianTicket, 0);
  assert.equal(result.largest, null);
  assert.equal(result.dailyMean, 0);
  assert.equal(result.dailyMedian, 0);
  assert.equal(result.dailyStd, 0);
  assert.equal(result.projectedTotal, 0);
  assert.equal(result.projectedLow, 0);
  assert.equal(result.projectedHigh, 0);
  assert.equal(result.prevSamePeriodTotal, 0);
  assert.equal(result.prevFullTotal, 0);
  assert.equal(result.momChange, null);
  assert.deepEqual(result.categories, []);
  assert.deepEqual(result.anomalies, []);
  assert.deepEqual(result.insights, []);
  assert.equal(result.peakHour, null);
  assert.equal(result.daysInMonth, 31);
  assert.deepEqual(result.activity, { noSpend: 31, active: 0 });
  assert.equal(result.longestNoSpendStreak, 31);
  assert.equal(result.currentNoSpendStreak, 31);
  assert.equal(result.daily.length, 31);
  assert.ok(result.daily.every(day => day.total === 0 && day.count === 0 && day.cumulative === 0));
  assert.ok(result.weekday.every(day => day.total === 0 && day.avg === 0));
  assert.ok(result.punchCard.flat().every(cell => cell.amount === 0 && cell.count === 0));
  assert.equal(result.trend.length, 6);
  assert.ok(result.trend.every(month => month.total === 0));
});

test('monthly analytics aggregate only the supplied month and preserve input records', () => {
  const before = snapshot(records);
  const settingsBefore = JSON.parse(JSON.stringify(settings));
  const result = computeMonthlyAnalytics(new Date(2020, 0, 15, 12), settings, records);

  assert.equal(result.hasData, true);
  assert.deepEqual(result.spendings, [lunch, dinner, commute]);
  assert.equal(result.total, 600);
  assert.equal(result.txCount, 3);
  assert.equal(result.avgTicket, 200);
  assert.equal(result.medianTicket, 200);
  assert.deepEqual(result.largest, lunch);
  assert.equal(result.daysInMonth, 31);
  assert.equal(result.elapsedDays, 31);
  assert.equal(result.isCurrentMonth, false);
  assert.equal(result.isFutureMonth, false);
  assert.equal(result.dailyMean, 600 / 31);
  assert.equal(result.dailyMedian, 0);
  assert.equal(result.projectedTotal, 600);
  assert.equal(result.projectedLow, 600);
  assert.equal(result.projectedHigh, 600);
  assert.deepEqual(result.projection, []);

  assert.equal(result.income, 10000);
  assert.equal(result.baseIncome, 10000);
  assert.equal(result.additionalIncome, 0);
  assert.equal(result.savingsRate, 0.94);
  assert.deepEqual(result.activity, { noSpend: 29, active: 2 });
  assert.equal(result.longestNoSpendStreak, 16);
  assert.equal(result.currentNoSpendStreak, 16);

  assert.deepEqual(result.daily.filter(day => day.count > 0).map(day => ({
    day: day.day, total: day.total, count: day.count, cumulative: day.cumulative,
  })), [
    { day: 2, total: 500, count: 2, cumulative: 500 },
    { day: 15, total: 100, count: 1, cumulative: 600 },
  ]);
  assert.equal(result.daily[30].cumulative, 600);
  assert.equal(result.weekday.reduce((total, day) => total + day.total, 0), 600);
  assert.equal(result.punchCard.flat().reduce((total, cell) => total + cell.amount, 0), 600);
  assert.equal(result.punchCard.flat().reduce((total, cell) => total + cell.count, 0), 3);
  assert.equal(result.peakHour, 12);
  assert.deepEqual(records, before);
  assert.deepEqual(settings, settingsBefore);
});

test('category and month comparisons use controlled current and previous month sums', () => {
  const result = computeMonthlyAnalytics(new Date(2020, 0, 15, 12), settings, records);
  assert.equal(result.prevSamePeriodTotal, 300);
  assert.equal(result.prevFullTotal, 300);
  assert.equal(result.momChange, 1);
  assert.deepEqual(result.categories, [
    { id: 'food', total: 400, count: 2, share: 400 / 600, prevTotal: 200, change: 1, avgTicket: 200 },
    { id: 'travel', total: 200, count: 1, share: 200 / 600, prevTotal: 100, change: 1, avgTicket: 200 },
  ]);
  assert.deepEqual(result.trend.map(point => ({
    year: point.date.getFullYear(),
    month: point.date.getMonth() + 1,
    total: point.total,
    isCurrent: point.isCurrent,
    isPartial: point.isPartial,
  })), [
    { year: 2019, month: 8, total: 0, isCurrent: false, isPartial: false },
    { year: 2019, month: 9, total: 0, isCurrent: false, isPartial: false },
    { year: 2019, month: 10, total: 0, isCurrent: false, isPartial: false },
    { year: 2019, month: 11, total: 50, isCurrent: false, isPartial: false },
    { year: 2019, month: 12, total: 300, isCurrent: false, isPartial: false },
    { year: 2020, month: 1, total: 600, isCurrent: true, isPartial: false },
  ]);
});

test('monthly analytics do not reuse another call’s data or synthesize missing baselines', () => {
  const january = new Date(2020, 0, 15, 12);
  computeMonthlyAnalytics(january, settings, records);
  const onlyCurrent = computeMonthlyAnalytics(january, settings, [lunch]);
  assert.equal(onlyCurrent.total, 300);
  assert.equal(onlyCurrent.txCount, 1);
  assert.equal(onlyCurrent.prevSamePeriodTotal, 0);
  assert.equal(onlyCurrent.prevFullTotal, 0);
  assert.equal(onlyCurrent.momChange, null);
  assert.deepEqual(onlyCurrent.categories, [
    { id: 'food', total: 300, count: 1, share: 1, prevTotal: 0, change: null, avgTicket: 300 },
  ]);
  assert.deepEqual(onlyCurrent.trend.map(month => month.total), [0, 0, 0, 0, 0, 300]);

  const otherMonths = computeMonthlyAnalytics(january, settings, [previousFood, nextMonth]);
  assert.equal(otherMonths.hasData, false);
  assert.equal(otherMonths.total, 0);
  assert.deepEqual(otherMonths.spendings, []);
  assert.deepEqual(otherMonths.categories, []);
  assert.equal(otherMonths.prevFullTotal, 200);
  assert.deepEqual(otherMonths.trend.map(month => month.total), [0, 0, 0, 0, 200, 0]);

  const empty = computeMonthlyAnalytics(january, settings, []);
  assert.equal(empty.hasData, false);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.spendings, []);
  assert.ok(empty.trend.every(month => month.total === 0));
});

test('no-spend streaks reset on any active day regardless of spending volume', () => {
  const values = [
    spending('small', '2020-01-03', '12:00', 1),
    spending('large', '2020-01-08', '12:00', 100000),
    spending('last-day', '2020-01-31', '12:00', 1),
  ];
  const result = computeMonthlyAnalytics(new Date(2020, 0, 15, 12), settings, values);
  assert.deepEqual(result.activity, { noSpend: 28, active: 3 });
  assert.equal(result.longestNoSpendStreak, 22);
  assert.equal(result.currentNoSpendStreak, 0);
  assert.ok(!result.insights.some(insight => /streak/.test(insight.title)));
});

test('unset income does not generate income comparisons or overspending warnings', () => {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const values = [spending('current', date, '12:00', 600)];
  const result = computeMonthlyAnalytics(today, { ...settings, income: 0 }, values);
  assert.equal(result.income, 0);
  assert.equal(result.savingsRate, 0);
  assert.equal(result.total, 600);
  assert.ok(result.projectedTotal >= result.total);
  assert.equal(result.activity.active, 1);
  assert.equal(result.activity.noSpend, result.elapsedDays - 1);
  assert.equal(result.currentNoSpendStreak, result.elapsedDays - 1);
  assert.ok(!result.insights.some(insight => /income|budget|target|limit|overspend/i.test(`${insight.title} ${insight.detail}`)));

  const empty = computeMonthlyAnalytics(today, { ...settings, income: 0 }, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.projectedTotal, 0);
  assert.equal(empty.savingsRate, 0);
  assert.deepEqual(empty.insights, []);
});

test('future months do not count unelapsed days as no-spend activity', () => {
  const today = new Date();
  const future = new Date(today.getFullYear() + 1, 0, 1, 12);
  const result = computeMonthlyAnalytics(future, settings, []);
  assert.equal(result.elapsedDays, 0);
  assert.deepEqual(result.activity, { noSpend: 0, active: 0 });
  assert.equal(result.longestNoSpendStreak, 0);
  assert.equal(result.currentNoSpendStreak, 0);
  assert.deepEqual(result.insights, []);
});

function incomeEntry(id: string, month: string, amount: number): IncomeEntry {
  return { id, month, amount, description: id };
}

test('analytics add only selected-month income while leaving spending and recurring settings unchanged', () => {
  const entries: readonly IncomeEntry[] = Object.freeze([
    Object.freeze(incomeEntry('bonus', '2020-01', 200)),
    Object.freeze(incomeEntry('gift', '2020-01', 50)),
    Object.freeze(incomeEntry('other-month', '2020-02', 900)),
    Object.freeze(incomeEntry('other-year', '2019-01', 9000)),
  ]);
  const settingsBefore = JSON.parse(JSON.stringify(settings));
  const recordsBefore = snapshot(records);
  const entriesBefore = entries.map(value => ({ ...value }));
  const result = computeMonthlyAnalytics(new Date(2020, 0, 15, 12), settings, records, entries);
  assert.equal(result.baseIncome, 10000);
  assert.equal(result.additionalIncome, 250);
  assert.equal(result.income, 10250);
  assert.equal(result.total, 600);
  assert.equal(result.projectedTotal, 600);
  assert.equal(result.savingsRate, (10250 - 600) / 10250);
  assert.equal(result.txCount, 3);
  assert.deepEqual(result.spendings, [lunch, dinner, commute]);
  assert.deepEqual(result.trend.map(point => point.total), [0, 0, 0, 50, 300, 600]);
  assert.deepEqual(settings, settingsBefore);
  assert.deepEqual(records, recordsBefore);
  assert.deepEqual(entries, entriesBefore);
});

test('analytics use additional income with zero base and do not treat income as spending data', () => {
  const date = new Date(2020, 0, 15, 12);
  const entries = [incomeEntry('extra', '2020-01', 1000)];
  const zeroBase = { ...settings, income: 0 };
  const result = computeMonthlyAnalytics(date, zeroBase, records, entries);
  assert.equal(result.baseIncome, 0);
  assert.equal(result.additionalIncome, 1000);
  assert.equal(result.income, 1000);
  assert.equal(result.total, 600);
  assert.equal(result.savingsRate, 0.4);
  const empty = computeMonthlyAnalytics(date, zeroBase, [], entries);
  assert.equal(empty.income, 1000);
  assert.equal(empty.hasData, false);
  assert.equal(empty.total, 0);
  assert.equal(empty.txCount, 0);
  assert.equal(empty.projectedTotal, 0);
  assert.equal(empty.savingsRate, 1);
  assert.deepEqual(empty.spendings, []);
  assert.deepEqual(empty.categories, []);
  assert.deepEqual(empty.insights, []);
});

test('analytics preserve exact cents in base, additional, and effective income', () => {
  const result = computeMonthlyAnalytics(new Date(2020, 0, 15, 12), { ...settings, income: 0.1 }, [], [
    incomeEntry('extra', '2020-01', 0.2),
    incomeEntry('excluded', '2021-01', 0.99),
  ]);
  assert.equal(result.baseIncome, 0.1);
  assert.equal(result.additionalIncome, 0.2);
  assert.equal(result.income, 0.3);
});

test('analytics recalculate income and savings after editing, moving, or deleting entries', () => {
  const date = new Date(2020, 0, 15, 12);
  const entries = [incomeEntry('extra', '2020-01', 1000)];
  const edited = entries.map(value => ({ ...value, amount: 2000 }));
  const moved = edited.map(value => ({ ...value, month: '2020-02' }));
  for (const [values, additionalIncome] of [[entries, 1000], [edited, 2000], [moved, 0], [[], 0]] as const) {
    const result = computeMonthlyAnalytics(date, settings, records, values);
    assert.equal(result.baseIncome, 10000);
    assert.equal(result.additionalIncome, additionalIncome);
    assert.equal(result.income, 10000 + additionalIncome);
    assert.equal(result.savingsRate, (result.income - 600) / result.income);
  }
  assert.equal(computeMonthlyAnalytics(new Date(2020, 1, 15, 12), settings, [], moved).income, 12000);
  assert.equal(settings.income, 10000);
});

test('historical and future analytics use the selected month and year rather than today', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2020, 0, 15, 12).getTime() });
  const entries = [
    incomeEntry('past', '2019-12', 200),
    incomeEntry('current', '2020-01', 9999),
    incomeEntry('future', '2021-01', 300),
  ];
  const past = computeMonthlyAnalytics(new Date(2019, 11, 15, 12), settings, records, entries);
  assert.equal(past.isCurrentMonth, false);
  assert.equal(past.isFutureMonth, false);
  assert.equal(past.baseIncome, 10000);
  assert.equal(past.additionalIncome, 200);
  assert.equal(past.income, 10200);
  assert.equal(past.total, 300);
  const future = computeMonthlyAnalytics(new Date(2021, 0, 15, 12), settings, [], entries);
  assert.equal(future.isFutureMonth, true);
  assert.equal(future.baseIncome, 10000);
  assert.equal(future.additionalIncome, 300);
  assert.equal(future.income, 10300);
  const noExtras = computeMonthlyAnalytics(new Date(2021, 1, 15, 12), settings, [], entries);
  assert.equal(noExtras.income, 10000);
  assert.equal(noExtras.additionalIncome, 0);
  assert.equal(settings.income, 10000);
});

test('current-month projected savings and overspend insights reference effective monthly income', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2020, 0, 15, 12).getTime() });
  const date = new Date(2020, 0, 15, 12);
  const values = Array.from({ length: 15 }, (_, index) =>
    spending(`day-${index + 1}`, `2020-01-${String(index + 1).padStart(2, '0')}`, '12:00', 100),
  );
  const base = Object.freeze({ ...settings, income: 2000 });
  const withoutExtras = computeMonthlyAnalytics(date, base, values);
  assert.equal(withoutExtras.projectedTotal, 3100);
  assert.ok(withoutExtras.insights.some(insight => insight.title === 'On pace to overspend your income'));
  const withExtras = computeMonthlyAnalytics(date, base, values, [
    incomeEntry('extra', '2020-01', 2000),
    incomeEntry('excluded-month', '2020-02', 50000),
    incomeEntry('excluded-year', '2021-01', 50000),
  ]);
  assert.equal(withExtras.isCurrentMonth, true);
  assert.equal(withExtras.baseIncome, 2000);
  assert.equal(withExtras.additionalIncome, 2000);
  assert.equal(withExtras.income, 4000);
  assert.equal(withExtras.total, 1500);
  assert.equal(withExtras.projectedTotal, 3100);
  assert.equal(withExtras.savingsRate, 900 / 4000);
  assert.ok(withExtras.insights.some(insight => insight.title === 'Projected spending within monthly income'));
  assert.ok(!withExtras.insights.some(insight => insight.title === 'On pace to overspend your income'));
  const extrasOnly = computeMonthlyAnalytics(date, { ...base, income: 0 }, values, [
    incomeEntry('extra', '2020-01', 4000),
  ]);
  assert.equal(extrasOnly.income, 4000);
  assert.equal(extrasOnly.savingsRate, 900 / 4000);
  assert.ok(extrasOnly.insights.some(insight => insight.title === 'Projected spending within monthly income'));
  assert.equal(base.income, 2000);
});

test('formatCompactSpending formats amounts into compact k representation for mobile display', () => {
  assert.equal(formatCompactSpending(0), '0');
  assert.equal(formatCompactSpending(500), '500 ₫');
  assert.equal(formatCompactSpending(-500), '-500 ₫');
  assert.equal(formatCompactSpending(50000), '50k');
  assert.equal(formatCompactSpending(125000), '125k');
  assert.equal(formatCompactSpending(-522000), '-522k');
  assert.equal(formatCompactSpending(1000000), '1.000k');
  assert.equal(formatCompactSpending(9370000), '9.370k');
  assert.equal(formatCompactSpending(13200000), '13.200k');
});

test('sanitizeMoneyInput and formatMoneyInputDisplay enforce numeric currency values and expand k shorthand', () => {
  assert.equal(sanitizeMoneyInput(''), '');
  assert.equal(sanitizeMoneyInput('abc!@#'), '');
  assert.equal(sanitizeMoneyInput('99k'), '99000');
  assert.equal(sanitizeMoneyInput('99K'), '99000');
  assert.equal(sanitizeMoneyInput('99.000k'), '99000000');
  assert.equal(sanitizeMoneyInput('99kkkk'), '99000');
  assert.equal(sanitizeMoneyInput('12.500.000'), '12500000');
  assert.equal(sanitizeMoneyInput('00050'), '50');
  assert.equal(formatMoneyInputDisplay('99000'), '99.000');
  assert.equal(formatMoneyInputDisplay('12500000'), '12.500.000');
  assert.equal(formatMoneyInputDisplay(''), '');
});
