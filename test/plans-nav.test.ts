import assert from 'node:assert/strict';
import test from 'node:test';
import { adjacentPeriodDate, isPastPeriod, parsePeriodParam, periodOf, type BudgetPeriodSetting } from '../src/lib/periods';

test('?period= accepts a real YYYY-MM-DD date and nothing else', () => {
  assert.equal(parsePeriodParam('2026-11-25'), '2026-11-25');
  assert.equal(parsePeriodParam('2028-02-29'), '2028-02-29');
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-5', 'abc', '', ' 2026-11-25', '2026-11-25T00:00', '20261125', '2027-02-29']) {
    assert.equal(parsePeriodParam(bad), null, bad);
  }
  assert.equal(parsePeriodParam(null), null);
  assert.equal(parsePeriodParam(undefined), null);
});

test('a period is past only when it ended before today', () => {
  const period = { start: '2026-10-25', end: '2026-11-24' };
  assert.equal(isPastPeriod(period, '2026-11-25'), true);
  assert.equal(isPastPeriod(period, '2026-11-24'), false, 'the period containing today is not past');
  assert.equal(isPastPeriod(period, '2026-10-01'), false, 'a future period is not past');
});

test('previous and next controls walk the periods without gaps or overlap', () => {
  const setting: BudgetPeriodSetting = { mode: 'monthly_from_day', startDay: 25, paycheckIncomeId: null };
  let period = periodOf(setting, [], '2026-11-10');
  const seen = [period];
  for (let step = 0; step < 4; step++) {
    period = periodOf(setting, [], adjacentPeriodDate(period, 'next'));
    seen.push(period);
  }
  seen.forEach((item, index) => { if (index > 0) assert.equal(item.start, seen[index - 1].nextStart); });
  for (let step = 0; step < 4; step++) {
    period = periodOf(setting, [], adjacentPeriodDate(period, 'previous'));
  }
  assert.deepEqual(period, seen[0]);
});
