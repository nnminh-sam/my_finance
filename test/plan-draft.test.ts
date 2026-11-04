import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlanDraft, describePlanDraft, validatePlanDraft } from "../src/lib/planDraft";

test("plan drafts validate into API input and describe themselves", () => {
  const draft = { ...createPlanDraft("2026-11-04", "Food"), amount: "35000", description: " Lunch " };
  assert.deepEqual(validatePlanDraft(draft), {
    amount: 35000, description: "Lunch", category: "Food", time: "12:00", startDate: "2026-11-04",
    frequency: "weekdays", interval: 1, daysOfWeek: [], endDate: null, sure: false,
  });
  // Interval and days only apply where they mean something; once never has an end.
  const weekly = validatePlanDraft({ ...draft, frequency: "weekly", interval: "2", daysOfWeek: [3, 1, 3] });
  assert.deepEqual([weekly.interval, weekly.daysOfWeek], [2, [1, 3]]);
  assert.equal(validatePlanDraft({ ...draft, frequency: "once", endDate: "2026-12-01" }).endDate, null);
  assert.equal(validatePlanDraft({ ...draft, frequency: "weekdays", interval: "9" }).interval, 1);
  for (const bad of [{ amount: "" }, { amount: "0" }, { amount: "1.234" }, { time: "" }, { category: "" }, { endDate: "2026-11-01" }, { frequency: "daily" as const, interval: "0" }]) {
    assert.throws(() => validatePlanDraft({ ...draft, ...bad }), JSON.stringify(bad));
  }
  assert.match(describePlanDraft(draft)!, /^35\.000 ₫ · Every weekday at 12:00 from 2026-11-04, with no end\./);
  assert.equal(describePlanDraft({ ...draft, amount: "" }), null);
});
