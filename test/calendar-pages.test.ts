import assert from 'node:assert/strict';
import test from 'node:test';
import { format } from 'date-fns';
import { buildPeriodPages } from '../src/lib/calendarWindow';
import { calendarPeriod, periodOf, periodsBetween, type BudgetPeriodSetting } from '../src/lib/periods';

const day = (date: Date) => format(date, 'yyyy-MM-dd');
const fromDay5: BudgetPeriodSetting = { mode: 'monthly_from_day', startDay: 5, paycheckIncomeId: null };

test('a pay cycle page holds every day of the cycle, from the week it starts to the week it ends', () => {
  const { pages } = buildPeriodPages([periodOf(fromDay5, [], '2026-11-07')]);
  const [page] = pages;
  assert.equal(page.key, '2026-11-05');
  assert.equal(page.weeks.length, 5);
  assert.equal(day(page.weeks[0][0]), '2026-11-02'); // Monday of the week of 5 Nov
  assert.equal(day(page.weeks[4][6]), '2026-12-06'); // Sunday of the week of 4 Dec
  const shown = new Set(page.days.map(day));
  for (const date of ['2026-11-05', '2026-11-30', '2026-12-04']) assert.ok(shown.has(date), date);
});

test('cycles and months that touch six weeks get six rows', () => {
  assert.equal(buildPeriodPages([periodOf(fromDay5, [], '2026-12-10')]).pages[0].weeks.length, 6); // 5 Dec (Sat) – 4 Jan (Mon)
  assert.equal(buildPeriodPages([calendarPeriod('2026-08-10')]).pages[0].weeks.length, 6); // 1 Aug is a Saturday
  assert.equal(buildPeriodPages([calendarPeriod('2026-11-10')]).pages[0].weeks.length, 6); // 30 Nov is a Monday
  assert.equal(buildPeriodPages([calendarPeriod('2027-02-10')]).pages[0].weeks.length, 4); // Feb 2027 starts on a Monday
});

test('every day of every period is on its own page, whatever the setting', () => {
  const settings: BudgetPeriodSetting[] = [
    { mode: 'calendar', startDay: 1, paycheckIncomeId: null },
    fromDay5,
    { mode: 'monthly_from_day', startDay: 25, paycheckIncomeId: null },
  ];
  for (const setting of settings) {
    const periods = periodsBetween(setting, [], '2026-01-01', '2027-12-31');
    const { pages, allDays } = buildPeriodPages(periods);
    assert.equal(pages.length, periods.length);
    for (const page of pages) {
      const shown = new Set(page.days.map(day));
      for (const date of [page.start, page.end]) assert.ok(shown.has(date), `${setting.mode} ${page.key}: ${date}`);
      assert.ok(page.weeks.every(week => week.length === 7 && week[0].getDay() === 1), `${page.key} weeks run Monday to Sunday`);
      assert.ok(page.weeks.length >= 4 && page.weeks.length <= 6, `${page.key} has ${page.weeks.length} weeks`);
    }
    // Shared days between neighbouring pages appear once in allDays.
    assert.equal(new Set(allDays.map(day)).size, allDays.length);
  }
});
