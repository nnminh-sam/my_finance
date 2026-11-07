import { randomUUID } from "node:crypto";
import { addDays, dueOccurrences, isPlanDate, localNowStamp, planOccurrences, stampOf } from "../../src/lib/plans";
import type { FinanceSettings, Income, IncomeInput, Plan, PlanExceptionInput, PlanInput, SettingsPatch, Spending } from "../../src/server/finance/model";

interface Host {
  getSettings(userId: string): Promise<FinanceSettings>;
  rows(userId: string): Map<string, Spending>;
}

/** In-memory twin of the Neon plan store methods, shared by the HTTP and MCP test fakes. */
export class MemoryPlans {
  plans = new Map<string, Map<string, Plan>>();
  /** Test clock; materialization and new watermarks use it. */
  now = () => new Date();

  constructor(private host: Host) {}

  planRows(userId: string) {
    if (!this.plans.has(userId)) this.plans.set(userId, new Map());
    return this.plans.get(userId)!;
  }

  private async localNow(userId: string) {
    return localNowStamp((await this.host.getSettings(userId)).timezone, this.now());
  }

  private async categoryOk(userId: string, category: string) {
    return (await this.host.getSettings(userId)).categories.some(item => item.id === category);
  }

  private view(plan: Plan): Plan {
    const copy = structuredClone(plan);
    copy.exceptions = copy.exceptions.filter(item => item.date >= copy.materializedThrough.slice(0, 10))
      .sort((a, b) => a.date.localeCompare(b.date));
    return copy;
  }

  async listPlans(userId: string) {
    await this.materializePlans(userId);
    return [...this.planRows(userId).values()].map(plan => this.view(plan));
  }

  async createPlan(userId: string, input: PlanInput) {
    if (!await this.categoryOk(userId, input.category)) return "invalid-category" as const;
    const plan: Plan = { id: randomUUID(), ...structuredClone(input), materializedThrough: await this.localNow(userId), createdAt: this.now().toISOString(), exceptions: [] };
    this.planRows(userId).set(plan.id, plan);
    return this.view(plan);
  }

  async updatePlan(userId: string, id: string, input: PlanInput) {
    const plan = this.planRows(userId).get(id);
    if (!plan) return "not-found" as const;
    if (!await this.categoryOk(userId, input.category)) return "invalid-category" as const;
    Object.assign(plan, structuredClone(input));
    return this.view(plan);
  }

  async splitPlan(userId: string, id: string, input: PlanInput) {
    const old = this.planRows(userId).get(id);
    if (!old) return "not-found" as const;
    if (old.frequency === "once" || input.startDate <= old.startDate) return "invalid-date" as const;
    if (!await this.categoryOk(userId, input.category)) return "invalid-category" as const;
    const created: Plan = {
      id: randomUUID(), ...structuredClone(input), materializedThrough: old.materializedThrough,
      createdAt: this.now().toISOString(), exceptions: old.exceptions.filter(item => item.date >= input.startDate),
    };
    const lastDay = addDays(input.startDate, -1);
    old.endDate = old.endDate && old.endDate < lastDay ? old.endDate : lastDay;
    old.exceptions = old.exceptions.filter(item => item.date < input.startDate);
    this.planRows(userId).set(created.id, created);
    return { ended: this.view(old), created: this.view(created) };
  }

  async deletePlan(userId: string, id: string) {
    if (!this.planRows(userId).delete(id)) return false;
    for (const row of this.host.rows(userId).values()) if (row.planId === id) row.planId = null;
    return true;
  }

  async setPlanException(userId: string, id: string, date: string, input: PlanExceptionInput) {
    const plan = this.planRows(userId).get(id);
    if (!plan) return "not-found" as const;
    if (!isPlanDate(plan, date) || stampOf(date, plan.time) <= plan.materializedThrough) return "invalid-date" as const;
    plan.exceptions = [...plan.exceptions.filter(item => item.date !== date), { date, ...input }];
    return this.view(plan);
  }

  async deletePlanException(userId: string, id: string, date: string) {
    const plan = this.planRows(userId).get(id);
    if (!plan) return "not-found" as const;
    plan.exceptions = plan.exceptions.filter(item => item.date !== date);
    return this.view(plan);
  }

  async completePlanOccurrence(userId: string, id: string, date: string, at?: Date) {
    const plan = this.planRows(userId).get(id);
    if (!plan) return "not-found" as const;
    const occurrence = planOccurrences(plan, date, date)[0];
    if (!occurrence || stampOf(date, plan.time) <= plan.materializedThrough) return "invalid-date" as const;
    const rows = this.host.rows(userId);
    if ([...rows.values()].some(row => row.planId === id && row.planDate === date)) return "invalid-date" as const;
    const now = localNowStamp((await this.host.getSettings(userId)).timezone, at ?? this.now());
    const [day, time] = stampOf(date, plan.time) <= now ? [date, plan.time] : [now.slice(0, 10), now.slice(11)];
    const spending: Spending = { id: randomUUID(), amount: occurrence.amount, description: occurrence.description, category: occurrence.category, date: day, time, planId: id, planDate: date };
    rows.set(spending.id, spending);
    return structuredClone(spending);
  }

  async materializePlans(userId: string, at?: Date) {
    const now = localNowStamp((await this.host.getSettings(userId)).timezone, at ?? this.now());
    const rows = this.host.rows(userId);
    const taken = new Set([...rows.values()].filter(row => row.planId).map(row => `${row.planId}|${row.planDate}`));
    let created = 0;
    for (const plan of this.planRows(userId).values()) {
      const due = dueOccurrences(plan, plan.materializedThrough, now);
      if (!due.length) continue;
      for (const item of due) {
        if (taken.has(`${item.planId}|${item.date}`)) continue;
        const spending: Spending = {
          id: randomUUID(), amount: item.amount, description: item.description, category: item.category,
          date: item.date, time: item.time, planId: item.planId, planDate: item.date,
        };
        rows.set(spending.id, spending);
        created++;
      }
      plan.materializedThrough = now > plan.materializedThrough ? now : plan.materializedThrough;
      plan.exceptions = plan.exceptions.filter(item => item.date >= now.slice(0, 10));
    }
    return created;
  }
}

const PAYCHECK_FREQUENCIES = ["weekly", "semimonthly", "monthly"];

/**
 * In-memory twin of the store's updateSettings. Only a patch with budgetPeriod is checked; a mode other than
 * paycheck clears the id, and paycheck mode needs one of the user's usable incomes.
 */
export function applySettingsPatch(current: FinanceSettings, patch: SettingsPatch, incomes: Map<string, Income>): FinanceSettings | "invalid-budget-period" {
  const { budgetPeriod, ...rest } = structuredClone(patch);
  const next: FinanceSettings = { ...current, ...rest };
  if (budgetPeriod) {
    const merged = { ...current.budgetPeriod, ...budgetPeriod };
    if (merged.mode !== "paycheck") merged.paycheckIncomeId = null;
    const income = merged.paycheckIncomeId ? incomes.get(merged.paycheckIncomeId) : undefined;
    if (merged.mode === "paycheck" && !(income && PAYCHECK_FREQUENCIES.includes(income.frequency))) return "invalid-budget-period";
    next.budgetPeriod = merged;
  }
  return next;
}

/** In-memory twin of the store's updateIncome guard (paycheck mode only). */
export function paycheckInUse(settings: FinanceSettings | undefined, id: string, input: IncomeInput): boolean {
  return settings?.budgetPeriod.mode === "paycheck" && settings.budgetPeriod.paycheckIncomeId === id && !PAYCHECK_FREQUENCIES.includes(input.frequency);
}

/** In-memory twin of the store's deleteIncome reset (only an existing settings row in paycheck mode is touched). */
export function resetPaycheck(settings: FinanceSettings | undefined, id: string): void {
  if (settings?.budgetPeriod.mode === "paycheck" && settings.budgetPeriod.paycheckIncomeId === id) {
    settings.budgetPeriod = { ...settings.budgetPeriod, mode: "calendar", paycheckIncomeId: null };
  }
}

/** In-memory twin of listPlanSpendings. */
export function planSpendingsBetween(rows: Iterable<Spending>, from: string, to: string): Spending[] {
  return structuredClone([...rows].filter(row => row.planId && row.planDate && row.planDate >= from && row.planDate <= to));
}
