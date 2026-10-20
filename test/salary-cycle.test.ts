import assert from 'node:assert/strict';
import test from 'node:test';
import { format } from 'date-fns';
import {
  clampDelayDays,
  clampSalaryDay,
  defaultSalaryCycleConfig,
  getPaydayForMonth,
  getSalaryCycleForMonth,
  getSpendingsForSalaryCycle,
  isDateInSalaryCycle,
  resolveActiveCycleMonthDate,
} from '../src/lib/salaryCycle';
import type { Spending } from '../src/types';

test('defaultSalaryCycleConfig starts with 5th of month, weekend shift enabled, includeNextPaydayInCycle enabled, and no month delays', () => {
  const cfg = defaultSalaryCycleConfig();
  assert.equal(cfg.salaryDay, 5);
  assert.equal(cfg.shiftWeekendToMonday, true);
  assert.equal(cfg.includeNextPaydayInCycle, true);
  assert.deepEqual(cfg.monthDelays, {});
});

test('clampSalaryDay and clampDelayDays enforce valid boundaries', () => {
  assert.equal(clampSalaryDay(0), 1);
  assert.equal(clampSalaryDay(5), 5);
  assert.equal(clampSalaryDay(31), 28);
  assert.equal(clampSalaryDay(NaN), 5);

  assert.equal(clampDelayDays(0), 0);
  assert.equal(clampDelayDays(4), 4);
  assert.equal(clampDelayDays(20), 14);
  assert.equal(clampDelayDays(-10), -7);
  assert.equal(clampDelayDays(NaN), 0);
});

test('getPaydayForMonth shifts Saturday and Sunday paydays to Monday when enabled', () => {
  // July 5, 2026 is a Sunday -> should shift +1d to Monday July 6, 2026
  const cfg = defaultSalaryCycleConfig();
  const jul2026 = getPaydayForMonth(new Date(2026, 6, 1), cfg);
  assert.equal(format(jul2026.nominalDate, 'yyyy-MM-dd'), '2026-07-05');
  assert.equal(jul2026.weekendShiftDays, 1);
  assert.equal(format(jul2026.actualDate, 'yyyy-MM-dd'), '2026-07-06');

  // September 5, 2026 is a Saturday -> should shift +2d to Monday September 7, 2026
  const sep2026 = getPaydayForMonth(new Date(2026, 8, 1), cfg);
  assert.equal(format(sep2026.nominalDate, 'yyyy-MM-dd'), '2026-09-05');
  assert.equal(sep2026.weekendShiftDays, 2);
  assert.equal(format(sep2026.actualDate, 'yyyy-MM-dd'), '2026-09-07');

  // When weekend shift is disabled, Saturday stays on the 5th
  const noWeekendShift = getPaydayForMonth(new Date(2026, 8, 1), {
    ...cfg,
    shiftWeekendToMonday: false,
  });
  assert.equal(noWeekendShift.weekendShiftDays, 0);
  assert.equal(format(noWeekendShift.actualDate, 'yyyy-MM-dd'), '2026-09-05');
});

test('getSalaryCycleForMonth computes cycle across month boundary and accounts for next month weekend or manual delay', () => {
  const cfg = defaultSalaryCycleConfig();

  // August 2026: Aug 5 is Wednesday (no shift).
  // Next month September 2026: Sep 5 is Saturday -> shifts to Monday Sep 7!
  // With includeNextPaydayInCycle: true (default), August salary cycle runs from Aug 5, 2026 through Sep 7, 2026 (34 days)
  const augCycle = getSalaryCycleForMonth(new Date(2026, 7, 15), cfg);
  assert.equal(augCycle.cycleMonth, '2026-08');
  assert.equal(format(augCycle.startDate, 'yyyy-MM-dd'), '2026-08-05');
  assert.equal(format(augCycle.endDate, 'yyyy-MM-dd'), '2026-09-07');
  assert.equal(format(augCycle.nextStartDate, 'yyyy-MM-dd'), '2026-09-07');
  assert.equal(augCycle.days.length, 34);

  // When includeNextPaydayInCycle is false, it ends the day before next payday (Sep 6, 33 days)
  const augCycleDayBefore = getSalaryCycleForMonth(new Date(2026, 7, 15), {
    ...cfg,
    includeNextPaydayInCycle: false,
  });
  assert.equal(format(augCycleDayBefore.endDate, 'yyyy-MM-dd'), '2026-09-06');
  assert.equal(augCycleDayBefore.days.length, 33);

  // Add a specific 2-day delay to October 2026 only (Oct 5 Mon + 2d = Oct 7 Wed)
  // November 5, 2026 is Thursday -> cycle ends on Nov 5, 2026 (next payday inclusive)
  const octDelayedCfg = {
    ...cfg,
    monthDelays: { '2026-10': 2 },
  };
  const octCycle = getSalaryCycleForMonth(new Date(2026, 9, 10), octDelayedCfg);
  assert.equal(octCycle.cycleMonth, '2026-10');
  assert.equal(octCycle.manualDelayDays, 2);
  assert.equal(format(octCycle.startDate, 'yyyy-MM-dd'), '2026-10-07');
  assert.equal(format(octCycle.endDate, 'yyyy-MM-dd'), '2026-11-05');

  // September 2026 cycle automatically extends to Oct 7 because Oct 2026 payday was delayed to Oct 7
  const sepCycleWithOctDelay = getSalaryCycleForMonth(new Date(2026, 8, 10), octDelayedCfg);
  assert.equal(format(sepCycleWithOctDelay.startDate, 'yyyy-MM-dd'), '2026-09-07');
  assert.equal(format(sepCycleWithOctDelay.endDate, 'yyyy-MM-dd'), '2026-10-07');
});

test('getSpendingsForSalaryCycle and isDateInSalaryCycle filter spendings accurately across month boundaries', () => {
  const cfg = defaultSalaryCycleConfig();
  // Oct 2026 cycle with includeNextPaydayInCycle=true: 2026-10-05 to 2026-11-05 (inclusive)
  const octCycle = getSalaryCycleForMonth(new Date(2026, 9, 15), cfg);

  assert.equal(isDateInSalaryCycle(new Date(2026, 9, 4), octCycle), false);
  assert.equal(isDateInSalaryCycle(new Date(2026, 9, 5), octCycle), true);
  assert.equal(isDateInSalaryCycle(new Date(2026, 10, 4), octCycle), true);
  assert.equal(isDateInSalaryCycle(new Date(2026, 10, 5), octCycle), true);
  assert.equal(isDateInSalaryCycle(new Date(2026, 10, 6), octCycle), false);

  const sampleSpendings: Spending[] = [
    { id: '1', amount: 100, description: 'Before payday', category: 'Food', date: '2026-10-04', time: '12:00' },
    { id: '2', amount: 250, description: 'On payday', category: 'Food', date: '2026-10-05', time: '12:00' },
    { id: '3', amount: 400, description: 'Next month early Nov', category: 'Bills', date: '2026-11-03', time: '09:00' },
    { id: '4', amount: 500, description: 'Next payday (inclusive end)', category: 'Food', date: '2026-11-05', time: '12:00' },
    { id: '5', amount: 600, description: 'After next payday', category: 'Food', date: '2026-11-06', time: '12:00' },
  ];

  const filtered = getSpendingsForSalaryCycle(octCycle, sampleSpendings);
  assert.deepEqual(filtered.map((s) => s.id), ['2', '3', '4']);
});

test('resolveActiveCycleMonthDate maps dates before payday to the previous cycle month', () => {
  const cfg = defaultSalaryCycleConfig();
  // Oct 3, 2026 is before Oct 5 payday -> belongs to 2026-09 cycle
  assert.equal(format(resolveActiveCycleMonthDate(new Date(2026, 9, 3), cfg), 'yyyy-MM'), '2026-09');
  // Oct 5, 2026 is on payday -> belongs to 2026-10 cycle
  assert.equal(format(resolveActiveCycleMonthDate(new Date(2026, 9, 5), cfg), 'yyyy-MM'), '2026-10');
});
