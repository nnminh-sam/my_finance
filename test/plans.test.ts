import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays, describePlanSchedule, dueOccurrences, isPlanDate, isValidTimeZone, localNowStamp,
  planDates, planOccurrences, projectPlans, type PlanLike,
} from "../src/lib/plans";

function plan(overrides: Partial<PlanLike> = {}): PlanLike {
  return {
    id: "p1", amount: 35000, description: "Lunch", category: "Food", time: "12:00",
    startDate: "2026-11-02", frequency: "weekdays", interval: 1, daysOfWeek: [], endDate: null,
    exceptions: [], ...overrides,
  };
}

test("plans: weekdays skip weekends and run forever", () => {
  // 2026-11-02 is a Monday.
  const dates = planDates(plan(), "2026-11-01", "2026-11-15");
  assert.deepEqual(dates, [
    "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06",
    "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13",
  ]);
  assert.equal(planDates(plan(), "2030-01-01", "2030-01-31").length, 23);
});

test("plans: once, daily interval, end date", () => {
  assert.deepEqual(planDates(plan({ frequency: "once", startDate: "2026-12-24" }), "2026-12-01", "2026-12-31"), ["2026-12-24"]);
  assert.deepEqual(planDates(plan({ frequency: "once", startDate: "2026-12-24" }), "2027-01-01", "2027-01-31"), []);
  assert.deepEqual(
    planDates(plan({ frequency: "daily", interval: 3, startDate: "2026-11-01", endDate: "2026-11-10" }), "2026-11-02", "2026-11-30"),
    ["2026-11-04", "2026-11-07", "2026-11-10"],
  );
});

test("plans: weekly days and interval anchored to the start week", () => {
  // Every 2 weeks on Tue + Thu starting Monday 2026-11-02.
  const p = plan({ frequency: "weekly", interval: 2, daysOfWeek: [2, 4] });
  assert.deepEqual(planDates(p, "2026-11-01", "2026-11-30"), ["2026-11-03", "2026-11-05", "2026-11-17", "2026-11-19"]);
  // Empty daysOfWeek = the start date's weekday.
  assert.deepEqual(planDates(plan({ frequency: "weekly", daysOfWeek: [] }), "2026-11-01", "2026-11-20"), ["2026-11-02", "2026-11-09", "2026-11-16"]);
});

test("plans: monthly clamps to the last day of short months", () => {
  const p = plan({ frequency: "monthly", startDate: "2026-01-31" });
  assert.deepEqual(planDates(p, "2026-01-01", "2026-05-31"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  assert.equal(isPlanDate(plan({ frequency: "monthly", startDate: "2026-01-15", interval: 2 }), "2026-02-15"), false);
  assert.equal(isPlanDate(plan({ frequency: "monthly", startDate: "2026-01-15", interval: 2 }), "2026-03-15"), true);
});

test("plans: exceptions skip and override single occurrences", () => {
  const p = plan({
    exceptions: [
      { date: "2026-11-03", kind: "skip", amount: null, description: null },
      { date: "2026-11-04", kind: "override", amount: 50000, description: "Team lunch" },
      { date: "2026-11-05", kind: "override", amount: 40000, description: null },
    ],
  });
  const occurrences = planOccurrences(p, "2026-11-02", "2026-11-05");
  assert.deepEqual(occurrences.map(o => [o.date, o.amount, o.description, o.overridden]), [
    ["2026-11-02", 35000, "Lunch", false],
    ["2026-11-04", 50000, "Team lunch", true],
    ["2026-11-05", 40000, "Lunch", true],
  ]);
});

test("plans: due occurrences are strictly after the watermark and at or before now", () => {
  const p = plan();
  // Watermark Monday 12:00 (already materialized), now Wednesday 11:59.
  const due = dueOccurrences(p, "2026-11-02T12:00", "2026-11-04T11:59");
  assert.deepEqual(due.map(o => o.date), ["2026-11-03"]);
  // At exactly 12:00 Wednesday's lunch becomes due.
  assert.deepEqual(dueOccurrences(p, "2026-11-02T12:00", "2026-11-04T12:00").map(o => o.date), ["2026-11-03", "2026-11-04"]);
  // Nothing is due when the watermark is already at or past now.
  assert.deepEqual(dueOccurrences(p, "2026-11-04T12:00", "2026-11-04T12:00"), []);
  // Catch-up after a long absence materializes every missed occurrence.
  assert.equal(dueOccurrences(p, "2026-11-02T12:00", "2026-12-31T23:59").length, 43);
});

test("plans: projection hides materialized and already-known real occurrences", () => {
  const p = { ...plan(), materializedThrough: "2026-11-04T12:00" };
  const projected = projectPlans([p], "2026-11-01", "2026-11-06");
  assert.deepEqual(projected.map(o => o.date), ["2026-11-05", "2026-11-06"]);
  const deduped = projectPlans([p], "2026-11-01", "2026-11-06", new Set(["p1|2026-11-05"]));
  assert.deepEqual(deduped.map(o => o.date), ["2026-11-06"]);
});

test("plans: local time zone stamps and descriptions", () => {
  const at = new Date("2026-11-04T05:30:00Z");
  assert.equal(localNowStamp("Asia/Ho_Chi_Minh", at), "2026-11-04T12:30");
  assert.equal(localNowStamp("UTC", at), "2026-11-04T05:30");
  assert.equal(localNowStamp("America/Los_Angeles", at), "2026-11-03T21:30");
  assert.equal(isValidTimeZone("Asia/Ho_Chi_Minh"), true);
  assert.equal(isValidTimeZone("Mars/Base"), false);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(describePlanSchedule(plan()), "Every weekday");
  assert.equal(describePlanSchedule(plan({ frequency: "weekly", daysOfWeek: [1, 3] })), "Weekly · Mon, Wed");
  assert.equal(describePlanSchedule(plan({ frequency: "monthly", startDate: "2026-11-05" })), "Monthly on day 5");
});
