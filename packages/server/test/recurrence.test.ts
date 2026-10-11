import assert from "node:assert/strict";
import { test } from "node:test";
import { addDaysUtc, daysBetweenUtc, formatDateUtc, generateOccurrences, isRuleDueForSync, parseDateUtc, type RecurrenceState } from "../src/finance/recurrence";

test("recurrence: daily generation respects interval and cap 100", () => {
  const rule: RecurrenceState = {
    startDate: "2026-10-11",
    frequency: "daily",
    interval: 2,
    endType: "unlimited",
    occurrencesCreated: 0,
    lastGeneratedDate: null,
  };
  const batch1 = generateOccurrences(rule, 100);
  assert.equal(batch1.dates.length, 100);
  assert.equal(batch1.dates[0], "2026-10-11");
  assert.equal(batch1.dates[1], "2026-10-13");
  assert.equal(batch1.dates[2], "2026-10-15");
  assert.equal(batch1.newOccurrencesCreated, 100);
  assert.equal(batch1.newLastGeneratedDate, batch1.dates[99]);

  // Next incremental batch continues seamlessly
  const rule2: RecurrenceState = {
    ...rule,
    occurrencesCreated: batch1.newOccurrencesCreated,
    lastGeneratedDate: batch1.newLastGeneratedDate,
  };
  const batch2 = generateOccurrences(rule2, 100);
  assert.equal(batch2.dates.length, 100);
  // Next date should be last date + 2 days
  assert.equal(batch2.dates[0], formatDateUtc(addDaysUtc(parseDateUtc(batch1.newLastGeneratedDate!), 2)));
  assert.equal(batch2.newOccurrencesCreated, 200);
});

test("recurrence: weekdays only generates Monday through Friday", () => {
  // 2026-10-11 is a Sunday
  const rule: RecurrenceState = {
    startDate: "2026-10-11",
    frequency: "weekdays",
    endType: "occurrences",
    totalOccurrences: 10,
    occurrencesCreated: 0,
    lastGeneratedDate: null,
  };
  const batch = generateOccurrences(rule);
  assert.equal(batch.dates.length, 10);
  assert.equal(batch.isComplete, true);
  // First occurrence should be Monday 2026-10-12
  assert.equal(batch.dates[0], "2026-10-12");
  for (const dateStr of batch.dates) {
    const day = parseDateUtc(dateStr).getUTCDay();
    assert.ok(day >= 1 && day <= 5, `Expected weekday but got day ${day} for ${dateStr}`);
  }
});

test("recurrence: weekly with specific days of week", () => {
  // Monday (1) and Thursday (4)
  const rule: RecurrenceState = {
    startDate: "2026-10-12", // Monday
    frequency: "weekly",
    interval: 1,
    daysOfWeek: [1, 4],
    endType: "occurrences",
    totalOccurrences: 4,
    occurrencesCreated: 0,
    lastGeneratedDate: null,
  };
  const batch = generateOccurrences(rule);
  assert.equal(batch.dates.length, 4);
  assert.deepEqual(batch.dates, [
    "2026-10-12", // Mon
    "2026-10-15", // Thu
    "2026-10-19", // Mon
    "2026-10-22", // Thu
  ]);
});

test("recurrence: monthly handles month ends and leap years", () => {
  const rule: RecurrenceState = {
    startDate: "2024-01-31",
    frequency: "monthly",
    interval: 1,
    endType: "occurrences",
    totalOccurrences: 4,
    occurrencesCreated: 0,
    lastGeneratedDate: null,
  };
  const batch = generateOccurrences(rule);
  assert.deepEqual(batch.dates, [
    "2024-01-31",
    "2024-02-29", // 2024 is a leap year, 29 days
    "2024-03-31",
    "2024-04-30", // April has 30 days
  ]);
});

test("recurrence: isRuleDueForSync triggers when near horizon", () => {
  const rule: RecurrenceState = {
    startDate: "2026-10-11",
    frequency: "daily",
    endType: "unlimited",
    occurrencesCreated: 100,
    lastGeneratedDate: "2027-01-18",
  };
  // Far before horizon: not due
  assert.equal(isRuleDueForSync(rule, "2026-10-11"), false);
  // 10 days before horizon: due (<= 14 days)
  assert.equal(isRuleDueForSync(rule, "2027-01-08"), true);
  // At or after horizon: due
  assert.equal(isRuleDueForSync(rule, "2027-01-20"), true);

  // Completed occurrences rule: never due
  const completedRule: RecurrenceState = {
    ...rule,
    endType: "occurrences",
    totalOccurrences: 100,
    occurrencesCreated: 100,
  };
  assert.equal(isRuleDueForSync(completedRule, "2027-01-20"), false);
});
