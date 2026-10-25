import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeRepeatFrequency, monthlyRepeatCost, repeatProgress, repeatsPerMonth } from '../src/lib/repeatRules';

test('repeat rules: describe frequency with interval and weekdays', () => {
  assert.equal(describeRepeatFrequency({ frequency: 'daily' }), 'Daily');
  assert.equal(describeRepeatFrequency({ frequency: 'daily', interval: 2 }), 'Every 2 days');
  assert.equal(describeRepeatFrequency({ frequency: 'weekdays' }), 'Weekdays');
  assert.equal(describeRepeatFrequency({ frequency: 'weekly', daysOfWeek: [1, 4] }), 'Weekly · Mon, Thu');
  assert.equal(describeRepeatFrequency({ frequency: 'weekly', interval: 2 }), 'Every 2 weeks');
  assert.equal(describeRepeatFrequency({ frequency: 'monthly', interval: 3 }), 'Every 3 months');
});

test('repeat rules: monthly estimate follows schedule', () => {
  assert.equal(repeatsPerMonth({ frequency: 'monthly' }), 1);
  assert.equal(repeatsPerMonth({ frequency: 'monthly', interval: 2 }), 0.5);
  assert.ok(Math.abs(repeatsPerMonth({ frequency: 'daily' }) - 30.4375) < 1e-9);
  assert.ok(Math.abs(repeatsPerMonth({ frequency: 'weekdays' }) - 30.4375 * 5 / 7) < 1e-9);
  // Weekly with no chosen days repeats on the start date's weekday: once a week.
  assert.equal(repeatsPerMonth({ frequency: 'weekly' }), repeatsPerMonth({ frequency: 'weekly', daysOfWeek: [3] }));
  assert.equal(monthlyRepeatCost({ frequency: 'weekly', daysOfWeek: [1, 4], amount: 70_000 }), Math.round(140_000 * 30.4375 / 7));
  assert.equal(monthlyRepeatCost({ frequency: 'monthly', amount: 3_000_000 }), 3_000_000);
});

test('repeat rules: progress only for counted rules', () => {
  assert.equal(repeatProgress({ endType: 'unlimited', occurrencesCreated: 5, totalOccurrences: null }), null);
  assert.equal(repeatProgress({ endType: 'until_date', occurrencesCreated: 5 }), null);
  assert.deepEqual(repeatProgress({ endType: 'occurrences', occurrencesCreated: 18, totalOccurrences: 40 }), { done: 18, total: 40 });
  assert.deepEqual(repeatProgress({ endType: 'occurrences', occurrencesCreated: 120, totalOccurrences: null }), { done: 100, total: 100 });
});
