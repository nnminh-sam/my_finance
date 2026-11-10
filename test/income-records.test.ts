import assert from "node:assert/strict";
import { test } from "node:test";
import { dueIncomePaydays } from "../src/lib/income";
import type { IncomeSchedule } from "../src/lib/income";

const salary: IncomeSchedule = { frequency: "monthly", startDate: "2026-07-25", endDate: null, weekendShift: true };

test("dueIncomePaydays: first run writes every past payday, weekend-shifted, up to now", () => {
  // 2026-07-25 is a Saturday and 2026-10-25 a Sunday: both are paid on the Friday before.
  assert.deepEqual(dueIncomePaydays(salary, null, "2026-11-10T08:00"), [
    { nominal: "2026-07-25", paid: "2026-07-24" },
    { nominal: "2026-08-25", paid: "2026-08-25" },
    { nominal: "2026-09-25", paid: "2026-09-25" },
    { nominal: "2026-10-25", paid: "2026-10-23" },
  ]);
});

test("dueIncomePaydays: only paydays after the watermark, from the start of the paid day", () => {
  assert.deepEqual(dueIncomePaydays(salary, "2026-11-10T08:00", "2026-11-24T23:59"), []);
  assert.deepEqual(dueIncomePaydays(salary, "2026-11-10T08:00", "2026-11-25T00:00"), [{ nominal: "2026-11-25", paid: "2026-11-25" }]);
  // A watermark inside the paid day means that payday was already written.
  assert.deepEqual(dueIncomePaydays(salary, "2026-11-25T00:00", "2026-11-25T09:00"), []);
  assert.deepEqual(dueIncomePaydays(salary, "2026-11-10T08:00", "2026-11-01T00:00"), []);
});

test("dueIncomePaydays: one-time, twice-a-month, short months and end dates", () => {
  assert.deepEqual(dueIncomePaydays({ frequency: "once", startDate: "2026-11-05", endDate: null }, null, "2026-11-10T08:00"),
    [{ nominal: "2026-11-05", paid: "2026-11-05" }]);
  assert.deepEqual(dueIncomePaydays({ frequency: "once", startDate: "2026-11-20", endDate: null }, null, "2026-11-10T08:00"), []);
  assert.deepEqual(dueIncomePaydays({ frequency: "semimonthly", semimonthlyDays: [15, 31], startDate: "2026-01-20", endDate: null }, null, "2026-02-28T00:00")
    .map(day => day.paid), ["2026-01-31", "2026-02-15", "2026-02-28"]);
  assert.deepEqual(dueIncomePaydays({ frequency: "monthly", startDate: "2026-01-31", endDate: "2026-03-30" }, null, "2026-12-01T00:00")
    .map(day => day.paid), ["2026-01-31", "2026-02-28"]);
});
