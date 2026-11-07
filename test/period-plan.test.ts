import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizePlanPeriod } from '../src/lib/periodSummary';
import {
  createPlansInOrder, dailyPlanName, earliestPlanDate, planDateAllowed, dailyPlanRange, dateInPeriod, draftTotal, leftAfterDraft, plannedNames, plannerCategories, planPeriodDraft,
  type ExistingPlan, type PlannerInput,
} from '../src/lib/periodPlan';

const period = { start: '2026-11-25', end: '2026-12-24' };
const categories = { bill: 'Bills', daily: 'Food', extra: 'Gifts' };
const empty: PlannerInput = { bills: [], dailyAmount: null, extras: [] };
const draft = (input: Partial<PlannerInput>, existing: ExistingPlan[] = [], today = '2026-11-10', p = period) =>
  planPeriodDraft({ period: p, today, input: { ...empty, ...input }, categories, existing });

test('bills become monthly sure plans starting on their date', () => {
  const result = draft({ bills: [{ name: ' Rent ', amount: 5_000_000, date: '2026-12-05' }] });
  assert.equal(result.plans.length, 1);
  assert.deepEqual(result.plans[0], {
    amount: 5_000_000, description: 'Rent', category: 'Bills', time: '08:00', startDate: '2026-12-05',
    frequency: 'monthly', interval: 1, daysOfWeek: [], endDate: null, sure: true,
  });
});

test('the daily amount is one daily estimate from the later of today and the period start to the period end', () => {
  const next = draft({ dailyAmount: 150_000 }, [], '2026-11-10');
  assert.deepEqual([next.plans[0].startDate, next.plans[0].endDate, next.plans[0].frequency, next.plans[0].sure], ['2026-11-25', '2026-12-24', 'daily', false], 'a coming period starts at its first day');
  const current = draft({ dailyAmount: 150_000 }, [], '2026-12-01');
  assert.equal(current.plans[0].startDate, '2026-12-01', 'the current period starts today');
  const oneDay = draft({ dailyAmount: 1 }, [], '2026-12-24');
  assert.deepEqual([oneDay.plans[0].startDate, oneDay.plans[0].endDate], ['2026-12-24', '2026-12-24']);
  assert.equal(draft({ dailyAmount: 100 }, [], '2026-12-25').plans.length, 0, 'no day left means no daily plan');
  assert.equal(draft({ dailyAmount: 0 }).plans.length, 0);
  assert.equal(draft({ dailyAmount: null }).plans.length, 0);
  assert.deepEqual(dailyPlanRange(period, '2026-11-10'), { start: '2026-11-25', end: '2026-12-24' });
  assert.equal(dailyPlanRange(period, '2027-01-01'), null);
});

test('extras become one-off plans on their date, and dates outside the period or not real are blocked', () => {
  const ok = draft({ extras: [{ name: 'Wedding gift', amount: 1_000_000, date: '2026-12-24' }] });
  assert.deepEqual([ok.plans[0].frequency, ok.plans[0].startDate, ok.plans[0].sure, ok.plans[0].category], ['once', '2026-12-24', false, 'Gifts']);
  const blocked = draft({
    bills: [{ name: 'Rent', amount: 1, date: '2026-11-24' }],
    extras: [{ name: 'Trip', amount: 1, date: '2026-12-25' }, { name: 'Odd', amount: 1, date: '2026-02-30' }],
  });
  assert.equal(blocked.plans.length, 0);
  assert.deepEqual(blocked.blockedDates, ['Rent', 'Trip', 'Odd']);
  assert.equal(dateInPeriod(period, '2026-11-25'), true);
  assert.equal(dateInPeriod(period, '2026-12-24'), true);
  assert.equal(dateInPeriod(period, '2026-11-24'), false);
  assert.equal(dateInPeriod(period, '2026-12-31'), false);
  assert.equal(dateInPeriod(period, 'abc'), false);
});

test('incomplete rows are ignored', () => {
  const result = draft({ bills: [{ name: '', amount: 5, date: '2026-12-01' }, { name: 'Rent', amount: 0, date: '2026-12-01' }], extras: [{ name: ' ', amount: 5, date: '2026-12-01' }] });
  assert.deepEqual(result, { plans: [], alreadyPlanned: [], blockedDates: [] });
});

test('already planned: same trimmed, case-insensitive description on an active plan is skipped', () => {
  const existing: ExistingPlan[] = [
    { description: 'rent', endDate: null },
    { description: 'Internet', endDate: '2026-11-09' },
    { description: 'Old gift', endDate: null, frequency: 'once', startDate: '2026-10-01' },
    { description: 'Next gift', endDate: null, frequency: 'once', startDate: '2026-12-01' },
  ];
  const result = draft({
    bills: [{ name: ' RENT ', amount: 1, date: '2026-12-05' }, { name: 'Internet', amount: 1, date: '2026-12-06' }, { name: 'Phone', amount: 1, date: '2026-12-07' }],
    extras: [{ name: 'Old gift', amount: 1, date: '2026-12-08' }, { name: 'next gift', amount: 1, date: '2026-12-09' }],
  }, existing);
  assert.deepEqual(result.plans.map(plan => plan.description), ['Internet', 'Phone', 'Old gift'], 'an ended plan and a one-off in the past do not block');
  assert.deepEqual(result.alreadyPlanned, ['RENT', 'next gift']);
  assert.deepEqual([...plannedNames(existing, '2026-11-10')].sort(), ['next gift', 'rent']);
});

test('the same name twice in one run creates one plan', () => {
  const result = draft({ bills: [{ name: 'Rent', amount: 1, date: '2026-12-01' }, { name: 'rent ', amount: 2, date: '2026-12-02' }] });
  assert.equal(result.plans.length, 1);
  assert.deepEqual(result.alreadyPlanned, ['rent']);
});

test('the daily plan is named after its period, so planning the next period is not blocked by this one', () => {
  const thisPeriod = draft({ dailyAmount: 100 }, [], '2026-12-01');
  const created: ExistingPlan = { description: thisPeriod.plans[0].description, endDate: thisPeriod.plans[0].endDate };
  assert.equal(created.description, dailyPlanName(period));
  const again = draft({ dailyAmount: 100 }, [created], '2026-12-01');
  assert.equal(again.plans.length, 0, 'the same period is not planned twice');
  const nextPeriod = { start: '2026-12-25', end: '2027-01-24' };
  assert.equal(draft({ dailyAmount: 100 }, [created], '2026-12-01', nextPeriod).plans.length, 1);
});

test('left until next payday: the saved figure minus bills in the period, the daily amount times remaining days and extras once', () => {
  const result = draft({
    bills: [{ name: 'Rent', amount: 400, date: '2026-12-05' }],
    dailyAmount: 10,
    extras: [{ name: 'Gift', amount: 50, date: '2026-12-20' }],
  }, [], '2026-12-01');
  assert.equal(draftTotal(period, result.plans), 400 + 10 * 24 + 50, 'Dec 1 to Dec 24 is 24 days');
  assert.equal(leftAfterDraft(1000, period, result.plans), 1000 - 690);
  assert.equal(leftAfterDraft(1000, period, []), 1000);
  const withoutBill = draft({ dailyAmount: 10, extras: [{ name: 'Gift', amount: 50, date: '2026-12-20' }] }, [], '2026-12-01');
  assert.equal(leftAfterDraft(1000, period, withoutBill.plans), 1000 - 290, 'removing the row restores the amount');
  const outside = draft({ extras: [{ name: 'Gift', amount: 50, date: '2027-01-02' }] });
  assert.equal(leftAfterDraft(1000, period, outside.plans), 1000, 'an extra outside the period is rejected, not counted');
  assert.equal(leftAfterDraft(0.3, period, draft({ bills: [{ name: 'A', amount: 0.1, date: '2026-12-01' }] }).plans), 0.2, 'cents stay exact');
});

test('creation stops at the first failure and a retry skips what was created', async () => {
  const input: Partial<PlannerInput> = {
    bills: [{ name: 'Rent', amount: 1, date: '2026-12-01' }, { name: 'Phone', amount: 1, date: '2026-12-02' }, { name: 'Gym', amount: 1, date: '2026-12-03' }],
  };
  const store: ExistingPlan[] = [];
  let failOn: string | null = 'Phone';
  const create = async (plan: { description: string; endDate: string | null }) => {
    if (plan.description === failOn) throw new Error('network down');
    store.push({ description: plan.description, endDate: plan.endDate });
  };
  const first = await createPlansInOrder(draft(input, store).plans, create, failure => (failure as Error).message);
  assert.deepEqual(first.created.map(plan => plan.description), ['Rent']);
  assert.equal(first.failed?.plan.description, 'Phone');
  assert.equal(first.failed?.message, 'network down');
  assert.deepEqual(store.map(plan => plan.description), ['Rent'], 'later plans were not tried');

  failOn = null;
  const retryDraft = draft(input, store);
  assert.deepEqual(retryDraft.plans.map(plan => plan.description), ['Phone', 'Gym']);
  assert.deepEqual(retryDraft.alreadyPlanned, ['Rent']);
  const second = await createPlansInOrder(retryDraft.plans, create, String);
  assert.equal(second.failed, null);
  assert.deepEqual(store.map(plan => plan.description), ['Rent', 'Phone', 'Gym'], 'no duplicates');
  assert.deepEqual(await createPlansInOrder([], create, String), { created: [], failed: null });
});

test('planner categories come from the user list with sensible fallbacks', () => {
  assert.deepEqual(plannerCategories([{ id: 'a', name: 'Bills' }, { id: 'b', name: 'Food' }, { id: 'c', name: 'Gifts' }]), { bill: 'a', daily: 'b', extra: 'c' });
  assert.deepEqual(plannerCategories([{ id: 'x', name: 'Misc' }, { id: 'o', name: 'Other' }]), { bill: 'o', daily: 'o', extra: 'o' });
  assert.deepEqual(plannerCategories([{ id: 'x', name: 'Misc' }]), { bill: 'x', daily: 'x', extra: 'x' });
  assert.deepEqual(plannerCategories([]), { bill: '', daily: '', extra: '' });
});

test('bills and extras take only days after today in the current period, and default to the earliest such day', () => {
  const midPeriod = '2026-12-01';
  assert.equal(earliestPlanDate(period, midPeriod), '2026-12-02');
  assert.equal(earliestPlanDate(period, '2026-11-10'), '2026-11-25', 'a coming period starts at its first day');
  assert.equal(earliestPlanDate(period, '2026-11-25'), '2026-11-26');
  const result = draft({
    bills: [{ name: 'Rent', amount: 1, date: earliestPlanDate(period, midPeriod) }, { name: 'Today bill', amount: 1, date: midPeriod }],
    extras: [{ name: 'Past gift', amount: 1, date: '2026-11-27' }, { name: 'Trip', amount: 1, date: '2026-12-20' }],
  }, [], midPeriod);
  assert.deepEqual(result.plans.map(plan => plan.description), ['Rent', 'Trip']);
  assert.deepEqual(result.blockedDates, ['Today bill', 'Past gift'], 'a past or same-day row is blocked, not created');
  assert.equal(planDateAllowed(period, midPeriod, '2026-12-02'), true);
  assert.equal(planDateAllowed(period, midPeriod, '2026-12-01'), false);
  assert.equal(planDateAllowed(period, '2026-12-24', '2026-12-24'), false, 'the last day has no allowed date left');
});

test('the preview equals what the server counts after the plans are created (watermark at now)', () => {
  const today = '2026-12-01';
  const result = draft({
    bills: [{ name: 'Rent', amount: 400, date: earliestPlanDate(period, today) }],
    dailyAmount: 10,
    extras: [{ name: 'Gift', amount: 50, date: '2026-12-20' }],
  }, [], today);
  const income = { id: 'i', source: 'Salary', name: '', amount: 5000, frequency: 'once' as const, startDate: '2026-12-10', endDate: null };
  const before = summarizePlanPeriod({ period: { ...period, nextStart: '2026-12-25', mode: 'monthly_from_day' }, today, incomes: [income], spendings: [], plans: [] });
  const preview = leftAfterDraft(before.left, period, result.plans);
  // The server creates each plan with its watermark at today 10:00, before the daily plan's 12:00 slot.
  const created = result.plans.map((plan, index) => ({ ...plan, id: `p${index}`, exceptions: [], materializedThrough: `${today}T10:00` }));
  const after = summarizePlanPeriod({ period: { ...period, nextStart: '2026-12-25', mode: 'monthly_from_day' }, today, incomes: [income], spendings: [], plans: created });
  assert.equal(preview, after.left);
});

test('a retry after a partial failure never creates a plan twice', async () => {
  const today = '2026-12-01';
  const input: Partial<PlannerInput> = {
    bills: [{ name: 'Rent', amount: 1, date: '2026-12-05' }],
    extras: [{ name: 'Gift', amount: 1, date: '2026-12-10' }, { name: 'Trip', amount: 1, date: '2026-12-20' }],
  };
  const store: (ExistingPlan & { frequency: string; startDate: string })[] = [];
  let failOn: string | null = 'Trip';
  const create = async (plan: { description: string; endDate: string | null; frequency: string; startDate: string }) => {
    if (plan.description === failOn) throw new Error('down');
    store.push({ description: plan.description, endDate: plan.endDate, frequency: plan.frequency, startDate: plan.startDate });
  };
  await createPlansInOrder(draft(input, store, today).plans, create, String);
  failOn = null;
  const retry = draft(input, store, today);
  assert.deepEqual(retry.plans.map(plan => plan.description), ['Trip']);
  assert.deepEqual(retry.alreadyPlanned, ['Rent', 'Gift']);
  await createPlansInOrder(retry.plans, create, String);
  assert.deepEqual(store.map(plan => plan.description), ['Rent', 'Gift', 'Trip']);
});
