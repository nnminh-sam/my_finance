import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dismissPayCycleHint, legacyPaydayKey, legacyPaydayPrefill, payCycleHintDismissedKey, readLegacyPayday, shouldShowPayCycleHint,
} from '../src/lib/legacyPayday';
import type { BudgetPeriodSetting } from '../src/lib/periods';

class FakeStorage {
  items = new Map<string, string>();
  fail = false;
  getItem(key: string) { if (this.fail) throw new Error('blocked'); return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error('blocked'); this.items.set(key, value); }
}
const withKey = (value: string, userId = 'u1') => { const storage = new FakeStorage(); storage.items.set(legacyPaydayKey(userId), value); return storage; };
const defaults = { budgetPeriod: { mode: 'calendar', startDay: 1, paycheckIncomeId: null } as BudgetPeriodSetting, showBy: 'calendar_month' as const };

test('legacy payday: only a whole day from 1 to 28 is read', () => {
  assert.equal(readLegacyPayday(withKey('{"salaryDay":25,"shiftWeekendToMonday":true}'), 'u1'), 25);
  assert.equal(readLegacyPayday(withKey('{"salaryDay":1}'), 'u1'), 1);
  assert.equal(readLegacyPayday(withKey('{"salaryDay":28}'), 'u1'), 28);
  for (const bad of ['{"salaryDay":0}', '{"salaryDay":29}', '{"salaryDay":"x"}', '{"salaryDay":12.5}', '{"salaryDay":null}', '{}', '[]', 'null', '7', '{bad json', '']) {
    assert.equal(readLegacyPayday(withKey(bad), 'u1'), null, bad);
  }
  assert.equal(readLegacyPayday(new FakeStorage(), 'u1'), null, 'missing key');
  assert.equal(readLegacyPayday(withKey('{"salaryDay":25}', 'other'), 'u1'), null, 'another user');
  assert.equal(readLegacyPayday(withKey('{"salaryDay":25}', 'default'), undefined), 25, 'no user id uses the default key');
  assert.equal(readLegacyPayday(null, 'u1'), null);
  const blocked = withKey('{"salaryDay":25}'); blocked.fail = true;
  assert.equal(readLegacyPayday(blocked, 'u1'), null, 'unreadable storage');
  assert.equal(legacyPaydayKey('u1'), 'tracker_salary_cycle_v1_u1');
});

test('prefill needs default server settings and a valid device payday, and never writes', () => {
  const storage = withKey('{"salaryDay":25}');
  assert.equal(legacyPaydayPrefill(defaults, storage, 'u1'), 25);
  assert.equal(legacyPaydayPrefill({ ...defaults, budgetPeriod: { mode: 'monthly_from_day', startDay: 10, paycheckIncomeId: null } }, storage, 'u1'), null);
  assert.equal(legacyPaydayPrefill({ ...defaults, budgetPeriod: { mode: 'calendar', startDay: 3, paycheckIncomeId: null } }, storage, 'u1'), null);
  assert.equal(legacyPaydayPrefill({ ...defaults, showBy: 'pay_cycle' }, storage, 'u1'), null);
  assert.equal(legacyPaydayPrefill({}, storage, 'u1'), 25, 'missing settings count as defaults');
  assert.equal(legacyPaydayPrefill(defaults, withKey('{"salaryDay":29}'), 'u1'), null);
  assert.deepEqual([...storage.items.keys()], [legacyPaydayKey('u1')], 'the old key is neither removed nor joined by a new one');
});

test('hint: legacy key, default settings and not dismissed', () => {
  const storage = withKey('{"salaryDay":25}');
  assert.equal(shouldShowPayCycleHint(defaults, 'u1', storage), true);
  assert.equal(shouldShowPayCycleHint(defaults, 'u1', new FakeStorage()), false, 'no key');
  assert.equal(shouldShowPayCycleHint(defaults, 'u1', withKey('{"salaryDay":0}')), false, 'invalid key');
  assert.equal(shouldShowPayCycleHint({ ...defaults, showBy: 'pay_cycle' }, 'u1', storage), false, 'saved non-default');
  assert.equal(shouldShowPayCycleHint({ ...defaults, budgetPeriod: { mode: 'monthly_from_day', startDay: 25, paycheckIncomeId: null } }, 'u1', storage), false, 'saved non-default');
  assert.equal(shouldShowPayCycleHint(defaults, 'u1', null), false);
  dismissPayCycleHint(storage, 'u1');
  assert.equal(storage.items.get(payCycleHintDismissedKey('u1')), '1');
  assert.equal(shouldShowPayCycleHint(defaults, 'u1', storage), false, 'dismissed');
  assert.equal(shouldShowPayCycleHint(defaults, 'u2', withKey('{"salaryDay":25}', 'u2')), true, 'the flag is per user');
  assert.ok(storage.items.has(legacyPaydayKey('u1')), 'dismissing keeps the old key');
});

test('hint: blocked storage never throws', () => {
  const storage = withKey('{"salaryDay":25}');
  storage.fail = true;
  assert.equal(shouldShowPayCycleHint(defaults, 'u1', storage), false);
  assert.doesNotThrow(() => dismissPayCycleHint(storage, 'u1'));
  assert.doesNotThrow(() => dismissPayCycleHint(null, 'u1'));
});
