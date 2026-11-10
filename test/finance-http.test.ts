import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { createApplication } from "../src/server/application";
import { hashToken, newToken } from "../src/server/auth/crypto";
import type { AuthStore, User } from "../src/server/auth/store";
import { defaultFinanceSettings, type FinanceSettings, type Income, type Plan, type IncomeInput, type IncomePage, type RepeatRule, type RepeatRuleInput, type SettingsPatch, type Spending, type SpendingInput } from "../src/server/finance/model";
import { formatDateUtc, generateOccurrences, isRuleDueForSync } from "../src/server/finance/recurrence";
import type { FinanceStore } from "../src/server/finance/store";
import { incomeInput as validateIncome } from "../src/server/finance/validation";
import { applySettingsPatch, MemoryPlans, paycheckInUse, planSpendingsBetween, resetPaycheck } from "./support/memoryPlans";
import { MemoryLedger } from "./support/memoryLedger";

class MemoryFinanceStore implements FinanceStore {
  planStore = new MemoryPlans(this);
  listPlans = this.planStore.listPlans.bind(this.planStore);
  createPlan = this.planStore.createPlan.bind(this.planStore);
  updatePlan = this.planStore.updatePlan.bind(this.planStore);
  splitPlan = this.planStore.splitPlan.bind(this.planStore);
  deletePlan = this.planStore.deletePlan.bind(this.planStore);
  setPlanException = this.planStore.setPlanException.bind(this.planStore);
  deletePlanException = this.planStore.deletePlanException.bind(this.planStore);
  materializePlans = this.planStore.materializePlans.bind(this.planStore);
  completePlanOccurrence = this.planStore.completePlanOccurrence.bind(this.planStore);
  mergeCategory = this.planStore.mergeCategory.bind(this.planStore);
  ledger = new MemoryLedger(this, () => this.planStore.now());
  listTransactions = this.ledger.listTransactions.bind(this.ledger);
  updateTransaction = this.ledger.updateTransaction.bind(this.ledger);
  deleteTransaction = this.ledger.deleteTransaction.bind(this.ledger);
  materializeIncomes = this.ledger.materializeIncomes.bind(this.ledger);
  settings = new Map<string, FinanceSettings>();
  spendings = new Map<string, Map<string, Spending>>();
  incomes = new Map<string, Map<string, Income>>();
  repeatRules = new Map<string, Map<string, RepeatRule>>();
  incomeRows(userId: string) {
    if (!this.incomes.has(userId)) this.incomes.set(userId, new Map());
    return this.incomes.get(userId)!;
  }
  repeatRuleRows(userId: string) {
    if (!this.repeatRules.has(userId)) this.repeatRules.set(userId, new Map());
    return this.repeatRules.get(userId)!;
  }
  fail = false;
  check() { if (this.fail) throw new Error("postgres://private:secret@example.test/db"); }
  rows(userId: string) {
    if (!this.spendings.has(userId)) this.spendings.set(userId, new Map());
    return this.spendings.get(userId)!;
  }
  async getSettings(userId: string) {
    this.check();
    if (!this.settings.has(userId)) this.settings.set(userId, defaultFinanceSettings());
    return structuredClone(this.settings.get(userId)!);
  }
  async updateSettings(userId: string, patch: SettingsPatch) {
    const settings = applySettingsPatch(await this.getSettings(userId), patch, this.incomeRows(userId));
    if (settings === "invalid-budget-period") return settings;
    this.settings.set(userId, settings);
    return structuredClone(settings);
  }
  async listPlanSpendings(userId: string, from: string, to: string) { this.check(); return planSpendingsBetween(this.rows(userId).values(), from, to); }
  async listSpendings(userId: string, limit: number, cursor?: string, startDate?: string, endDate?: string) {
    this.check();
    await this.syncRepeatSpendings(userId);
    await this.materializePlans(userId);
    const rows = [...this.rows(userId).values()]
      .filter(row => (!cursor || row.id > cursor) && (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const spendings = rows.slice(0, limit);
    return { spendings: structuredClone(spendings), nextCursor: rows.length > limit ? spendings[spendings.length - 1].id : null };
  }
  async createSpending(userId: string, input: SpendingInput) {
    if (!(await this.getSettings(userId)).categories.some(category => category.id === input.category)) return undefined;
    const spending: Spending = { id: randomUUID(), ...input };
    if (!input.repeatRuleId) delete spending.repeatRuleId;
    this.rows(userId).set(spending.id, spending);
    return structuredClone(spending);
  }
  async updateSpending(userId: string, id: string, input: SpendingInput) {
    this.check();
    if (!this.rows(userId).has(id)) return "not-found" as const;
    if (!(await this.getSettings(userId)).categories.some(category => category.id === input.category)) return "invalid-category" as const;
    const { planId, planDate } = this.rows(userId).get(id)!;
    const spending: Spending = { id, ...input };
    if (!input.repeatRuleId) delete spending.repeatRuleId;
    if (planId) Object.assign(spending, { planId, planDate });
    this.rows(userId).set(id, spending);
    return structuredClone(spending);
  }
  async deleteSpending(userId: string, id: string) { this.check(); return this.rows(userId).delete(id); }
  async listIncomes(userId: string, limit: number, cursor?: string) {
    this.check();
    await this.ledger.materializeIncomes(userId);
    const rows = [...this.incomeRows(userId).values()].filter(row => !cursor || row.id > cursor)
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const incomes = rows.slice(0, limit);
    return { incomes: structuredClone(incomes), nextCursor: rows.length > limit ? incomes[incomes.length - 1].id : null };
  }
  async createIncome(userId: string, input: IncomeInput) {
    this.check();
    const income = { id: randomUUID(), ...input };
    this.incomeRows(userId).set(income.id, income);
    return structuredClone(income);
  }
  async updateIncome(userId: string, id: string, input: IncomeInput) {
    this.check();
    if (!this.incomeRows(userId).has(id)) return undefined;
    if (paycheckInUse(this.settings.get(userId), id, input)) return "paycheck-in-use" as const;
    const before = this.incomeRows(userId).get(id)!;
    const income = { id, ...input };
    this.incomeRows(userId).set(id, income);
    this.ledger.incomeUpdated(userId, before, income);
    return structuredClone(income);
  }
  async deleteIncome(userId: string, id: string) {
    this.check();
    resetPaycheck(this.settings.get(userId), id);
    const before = this.incomeRows(userId).get(id);
    if (before) this.ledger.incomeDeleted(userId, before);
    return this.incomeRows(userId).delete(id);
  }
  async listRepeatRules(userId: string) {
    this.check();
    await this.syncRepeatSpendings(userId);
    return [...this.repeatRuleRows(userId).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async createRepeatRule(userId: string, input: RepeatRuleInput) {
    this.check();
    if (!(await this.getSettings(userId)).categories.some(c => c.id === input.category)) return undefined;
    const ruleId = randomUUID();
    const batch = generateOccurrences({
      startDate: input.startDate,
      frequency: input.frequency,
      interval: input.interval ?? 1,
      daysOfWeek: input.daysOfWeek,
      endType: input.endType,
      totalOccurrences: input.totalOccurrences,
      endDate: input.endDate,
      occurrencesCreated: 0,
      lastGeneratedDate: null,
    }, 100);

    const rule: RepeatRule = {
      id: ruleId,
      userId,
      ...input,
      occurrencesCreated: batch.newOccurrencesCreated,
      lastGeneratedDate: batch.newLastGeneratedDate,
      createdAt: new Date().toISOString(),
    };
    this.repeatRuleRows(userId).set(ruleId, rule);

    const spendings: Spending[] = [];
    for (const d of batch.dates) {
      const spending: Spending = {
        id: randomUUID(),
        amount: input.amount,
        description: input.description,
        category: input.category,
        date: d,
        time: input.time,
        repeatRuleId: ruleId,
      };
      this.rows(userId).set(spending.id, spending);
      spendings.push(spending);
    }
    return { repeatRule: structuredClone(rule), spendings: structuredClone(spendings) };
  }
  async deleteRepeatRule(userId: string, id: string, deleteFuture = true) {
    this.check();
    if (!this.repeatRuleRows(userId).has(id)) return false;
    if (deleteFuture) {
      const today = formatDateUtc(new Date());
      for (const [spendingId, spending] of [...this.rows(userId).entries()]) {
        if (spending.repeatRuleId === id && spending.date >= today) {
          this.rows(userId).delete(spendingId);
        }
      }
    }
    return this.repeatRuleRows(userId).delete(id);
  }
  async syncRepeatSpendings(userId: string, asOfDate = formatDateUtc(new Date())) {
    this.check();
    let totalCreated = 0;
    for (const rule of this.repeatRuleRows(userId).values()) {
      if (!isRuleDueForSync(rule, asOfDate)) continue;
      const batch = generateOccurrences(rule, 100);
      if (batch.dates.length === 0) continue;
      rule.occurrencesCreated = batch.newOccurrencesCreated;
      rule.lastGeneratedDate = batch.newLastGeneratedDate;
      for (const d of batch.dates) {
        const spending: Spending = {
          id: randomUUID(),
          amount: rule.amount,
          description: rule.description,
          category: rule.category,
          date: d,
          time: rule.time,
          repeatRuleId: rule.id,
        };
        this.rows(userId).set(spending.id, spending);
      }
      totalCreated += batch.dates.length;
    }
    return totalCreated;
  }
}


const origin = "http://localhost:5173";
const input: SpendingInput = { amount: 12.34, description: "Lunch", category: "Food", date: "2024-02-29", time: "12:05" };
const incomeInput: IncomeInput = { source: "Salary", name: "Company", amount: 100.29, frequency: "monthly", startDate: "2024-02-29", endDate: null };

async function fixture(t: TestContext) {
  const users: User[] = [0, 1].map(index => ({ id: randomUUID(), name: `User ${index}`, email: `${index}@example.test`, createdAt: new Date().toISOString() }));
  const tokens = users.map(() => newToken());
  const hashes = tokens.map(hashToken);
  const authStore: AuthStore = {
    async authenticate(hash) { return users[hashes.indexOf(hash)]; },
    async reserveAttempt() { return true; }, async findAccount() { return undefined; },
    async register() { return undefined; }, async createSession() {}, async rotate() { return undefined; }, async revoke() {}, async deleteAccount() { return false; },
  };
  const store = new MemoryFinanceStore();
  const app = createApplication({ databaseUrl: "unused", appOrigin: origin, production: false }, authStore, store);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/finance`;
  function request(path: string, method = "GET", body?: unknown, user = 0, headers: Record<string, string> = {}) {
    return fetch(`${url}${path}`, {
      method, headers: { Origin: origin, Authorization: `Bearer ${tokens[user]}`, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  return { store, users, tokens, request, url };
}

async function settings(response: Response): Promise<FinanceSettings> {
  assert.equal(response.status, 200);
  const settings = (await response.json() as { settings: FinanceSettings }).settings;
  assert.deepEqual(Object.keys(settings).sort(), ["avatar", "budgetPeriod", "categories", "showBy", "timezone"]);
  return settings;
}
async function created(response: Response): Promise<Spending> {
  assert.equal(response.status, 201);
  return (await response.json() as { spending: Spending }).spending;
}

test("finance routes require opaque bearer authentication; origin guard and CORS cover writes", async t => {
  const { request, url } = await fixture(t);
  for (const [path, method, body] of [
    ["/settings", "GET", undefined], ["/settings", "PUT", {}], ["/spendings", "GET", undefined],
    ["/spendings", "POST", input], [`/spendings/${randomUUID()}`, "PUT", input], [`/spendings/${randomUUID()}`, "DELETE", undefined],
    ["/incomes", "GET", undefined], ["/incomes", "POST", incomeInput],
    [`/incomes/${randomUUID()}`, "PUT", incomeInput], [`/incomes/${randomUUID()}`, "DELETE", undefined],
  ] as const) {
    assert.equal((await request(path, method, body, 0, { Authorization: "" })).status, 401);
    assert.equal((await request(path, method, body, 0, { Authorization: "Bearer invalid" })).status, 401);
    assert.equal((await request(path, method, body, 0, { Authorization: "", Cookie: `mf_refresh=${newToken()}` })).status, 401);
  }
  for (const method of ["PUT", "DELETE"]) {
    const path = method === "PUT" ? "/settings" : `/spendings/${randomUUID()}`;
    assert.equal((await request(path, method, method === "PUT" ? {} : undefined, 0, { Origin: "https://evil.example" })).status, 403);
  }
  // No Origin and no cookie is a native client: the guard lets it through to bearer auth.
  const missingOrigin = await fetch(`${url}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(missingOrigin.status, 401);
  // No Origin with a cookie could be a forged browser request: rejected before auth.
  const missingOriginWithCookie = await fetch(`${url}/settings`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: `mf_refresh=${newToken()}` }, body: "{}" });
  assert.equal(missingOriginWithCookie.status, 403);
  const preflight = await fetch(`${url}/settings`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "PUT" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.match(preflight.headers.get("access-control-allow-methods")!, /PUT/);
  assert.match(preflight.headers.get("access-control-allow-methods")!, /DELETE/);
  const response = await request("/settings");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("settings have default categories, persist partial/full changes, and isolate users", async t => {
  const { request, users, store } = await fixture(t);
  assert.deepEqual(await settings(await request(`/settings?userId=${users[1].id}`)), defaultFinanceSettings());
  assert.deepEqual(await (await request("/spendings")).json(), { spendings: [], nextCursor: null });
  const updated = await settings(await request("/settings", "PUT", { avatar: "https://example.test/first.png" }));
  assert.equal(updated.avatar, "https://example.test/first.png");
  assert.deepEqual(updated.categories, defaultFinanceSettings().categories);
  assert.deepEqual(await settings(await request("/settings")), updated);
  assert.deepEqual(await settings(await request("/settings", "GET", undefined, 1)), defaultFinanceSettings());
  const full = { ...updated, avatar: "https://example.test/avatar.png", categories: [{ id: "custom", name: "Custom", color: "#ABCDEF", icon: "Coffee" }] };
  assert.deepEqual(await settings(await request("/settings", "PUT", full)), full);
  assert.deepEqual(await settings(await request("/settings", "PUT", {})), full);
  assert.equal((await settings(await request("/settings", "PUT", { avatar: "" }))).avatar, "");
  assert.equal(store.settings.size, 2);
});

test("archived categories round-trip, and merge moves spendings then archives the source", async t => {
  const { request } = await fixture(t);
  const defaults = defaultFinanceSettings().categories;
  const archivedList = defaults.map(item => item.id === "Other" ? { ...item, archived: true } : item);
  const saved = await settings(await request("/settings", "PUT", { categories: archivedList }));
  assert.deepEqual(saved.categories.find(item => item.id === "Other"), { ...defaults.find(item => item.id === "Other"), archived: true });
  assert.equal(Object.hasOwn(saved.categories.find(item => item.id === "Food")!, "archived"), false);
  assert.equal((await request("/settings", "PUT", { categories: defaults.map(item => ({ ...item, archived: "yes" })) })).status, 400);
  const many = Array.from({ length: 151 }, (_, index) => ({ id: `c${index}`, name: `C ${index}`, color: "#10b981", icon: "Utensils" }));
  assert.equal((await request("/settings", "PUT", { categories: many })).status, 400);
  assert.equal((await request("/settings", "PUT", { categories: many.slice(0, 150) })).status, 200);
  await request("/settings", "PUT", { categories: archivedList });

  await created(await request("/spendings", "POST", input));
  await created(await request("/spendings", "POST", { ...input, description: "Dinner" }));
  // An archived category can still be named on a spending, so old ones stay editable.
  await created(await request("/spendings", "POST", { ...input, category: "Other" }));

  for (const body of [{ from: "Food", into: "Other" }, { from: "Food", into: "Food" }, { from: "Missing", into: "Bills" }, { from: "Food" }]) {
    assert.equal((await request("/settings/categories/merge", "POST", body)).status, 400, JSON.stringify(body));
  }
  const merged = await request("/settings/categories/merge", "POST", { from: "Food", into: "Bills" });
  assert.equal(merged.status, 200);
  const result = await merged.json() as { settings: FinanceSettings; spendings: number; plans: number };
  assert.equal(result.spendings, 2);
  assert.equal(result.plans, 0);
  assert.equal(result.settings.categories.find(item => item.id === "Food")?.archived, true);
  const list = await request("/spendings");
  const spendings = (await list.json() as { spendings: Spending[] }).spendings;
  assert.deepEqual(spendings.map(item => item.category).sort(), ["Bills", "Bills", "Other"]);
});

test("legacy settings fields are rejected without mutating active settings", async t => {
  const { request } = await fixture(t);
  const initial = await settings(await request("/settings", "PUT", { avatar: "https://example.test/avatar.png" }));
  // Recurring income moved to /incomes; the old settings field is now rejected like the daily limits.
  for (const field of ["income", "baseDailySpending", "maxDailySpending", "base_daily_spending", "max_daily_spending"]) {
    for (const body of [{ [field]: 0 }, { ...initial, avatar: "https://example.test/other.png", [field]: 10.01 }]) {
      assert.equal((await request("/settings", "PUT", body)).status, 400, JSON.stringify(body));
      assert.deepEqual(await settings(await request("/settings")), initial);
    }
  }
  assert.deepEqual(await settings(await request("/settings", "GET", undefined, 1)), defaultFinanceSettings());
});

test("spending CRUD uses only authenticated ownership and retains historical categories", async t => {
  const { request, users } = await fixture(t);
  const spending = await created(await request(`/spendings?userId=${users[1].id}`, "POST", input));
  assert.deepEqual({ ...spending, id: "id" }, { id: "id", ...input });
  assert.deepEqual(Object.keys(spending).sort(), ["amount", "category", "date", "description", "id", "time"]);
  const path = `/spendings/${spending.id}`;
  assert.equal((await request(path, "PUT", input, 1)).status, 404);
  assert.equal((await request(path, "DELETE", undefined, 1)).status, 404);
  assert.deepEqual(await (await request("/spendings", "GET", undefined, 1)).json(), { spendings: [], nextCursor: null });
  const updatedInput = { ...input, amount: 0.29, category: "Other", description: "Updated", date: "2025-01-01", time: "23:59" };
  const updated = await request(path, "PUT", updatedInput);
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { spending: { id: spending.id, ...updatedInput } });
  await settings(await request("/settings", "PUT", { categories: [] }));
  assert.deepEqual(await (await request("/spendings")).json(), { spendings: [{ id: spending.id, ...updatedInput }], nextCursor: null });
  assert.equal((await request("/spendings", "POST", input)).status, 400);
  assert.equal((await request(path, "PUT", updatedInput)).status, 400);
  assert.equal((await request(`/spendings/${randomUUID()}`, "PUT", input)).status, 404);
  const deleted = await request(path, "DELETE");
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), "");
  assert.equal((await request(path, "DELETE")).status, 404);
  assert.equal((await request(path, "PUT", input)).status, 404);
});

test("strict settings validation rejects invalid money, avatar, fields and categories without mutation", async t => {
  const { request } = await fixture(t);
  const category = defaultFinanceSettings().categories[0];
  const bodies: unknown[] = [null, [], "bad", { income: 1 }, { avatar: null }, { name: "Profile" }, { email: "a@b.test" }, { theme: "light" }, { userId: randomUUID() },
    { avatar: "javascript:alert(1)" }, { avatar: "data:image/png;base64,xxx" }, { avatar: "//example.test/a" }, { avatar: "https://user:pass@example.test/a" },
    { avatar: "https://example.test/" + "a".repeat(2048) }, { avatar: " " }, { categories: {} }, { categories: null },
    { categories: Array.from({ length: 151 }, (_, i) => ({ ...category, id: String(i), name: `c${i}` })) }, { categories: [category, category] },
  ];
  for (const patch of [{ id: "" }, { id: "a".repeat(101) }, { name: " " }, { name: "a".repeat(101) }, { color: "#fff" },
    { color: "#GGGGGG" }, { icon: "NotAnIcon" }, { icon: 1 }, { extra: true }]) bodies.push({ categories: [{ ...category, ...patch }] });
  for (const body of bodies) assert.equal((await request("/settings", "PUT", body)).status, 400, JSON.stringify(body));
  assert.deepEqual(await settings(await request("/settings")), defaultFinanceSettings());
  const boundaries = await settings(await request("/settings", "PUT", { avatar: "http://example.test/a" }));
  assert.equal(boundaries.avatar, "http://example.test/a");
});

test("spending validation requires full bodies, real calendar dates, minute times and positive cents", async t => {
  const { request } = await fixture(t);
  const spending = await created(await request("/spendings", "POST", input));
  const bodies: unknown[] = [null, [], {}, { ...input, user_id: randomUUID() }];
  for (const field of Object.keys(input)) { const body = { ...input } as Record<string, unknown>; delete body[field]; bodies.push(body); }
  for (const amount of [0, -1, 1e12 + 1, 0.001, 1e-7, "1", null, Number.NaN]) bodies.push({ ...input, amount });
  for (const date of ["2023-02-29", "1900-02-29", "2024-02-30", "2024-04-31", "2024-00-01", "2024-13-01", "2024-01-00", "0000-01-01", "24-01-01", "2024-1-01"]) bodies.push({ ...input, date });
  for (const time of ["24:00", "12:60", "-1:00", "1:00", "12:00:00"]) bodies.push({ ...input, time });
  for (const patch of [{ description: "a".repeat(1001) }, { description: null }, { category: "unknown" }, { category: "a".repeat(101) }, { category: "" }]) bodies.push({ ...input, ...patch });
  for (const body of bodies) {
    assert.equal((await request("/spendings", "POST", body)).status, 400, JSON.stringify(body));
    assert.equal((await request(`/spendings/${spending.id}`, "PUT", body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(await (await request("/spendings")).json(), { spendings: [spending], nextCursor: null });
  for (const date of ["0001-01-01", "2000-02-29", "9999-12-31"]) {
    await created(await request("/spendings", "POST", { ...input, amount: 1e12, description: "", date, time: "00:00" }));
  }
  assert.equal((await request("/spendings/not-a-uuid", "PUT", input)).status, 400);
  assert.equal((await request("/spendings/not-a-uuid", "DELETE")).status, 400);
});

test("UUID ascending cursor pagination retrieves all records, is user scoped and validates inputs", async t => {
  const { request, store, users } = await fixture(t);
  const ids = Array.from({ length: 503 }, () => randomUUID()).sort();
  for (const id of ids) store.rows(users[0].id).set(id, { id, ...input });
  store.rows(users[1].id).set(randomUUID(), { id: randomUUID(), ...input });
  const first = await (await request("/spendings?limit=500")).json() as { spendings: Spending[]; nextCursor: string | null };
  assert.deepEqual(first.spendings.map(row => row.id), ids.slice(0, 500));
  assert.equal(first.nextCursor, ids[499]);
  const second = await (await request(`/spendings?cursor=${first.nextCursor}&limit=500`)).json() as { spendings: Spending[]; nextCursor: string | null };
  assert.deepEqual(second.spendings.map(row => row.id), ids.slice(500));
  assert.equal(second.nextCursor, null);
  const smallPages: string[] = [];
  let cursor: string | null = null;
  do {
    const response = await request(`/spendings?limit=37${cursor ? `&cursor=${cursor}` : ""}`);
    const page = await response.json() as { spendings: Spending[]; nextCursor: string | null };
    smallPages.push(...page.spendings.map(row => row.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(smallPages, ids);
  // The boundary is a UUID value, not a lookup: it remains valid after deletion.
  store.rows(users[0].id).delete(ids[499]);
  assert.deepEqual(await (await request(`/spendings?cursor=${ids[499].toUpperCase()}`)).json(), second);
  for (const query of ["limit=0", "limit=501", "limit=-1", "limit=1.5", "limit=01", "limit=", "limit=1&limit=2", "limit[x]=2", "cursor=bad", "cursor=", `cursor=${ids[0]}&cursor=${ids[1]}`, "cursor[x]=x"]) {
    assert.equal((await request(`/spendings?${query}`)).status, 400, query);
  }
});

test("finance failures and malformed JSON do not expose sensitive state", async t => {
  const { request, store, url, tokens } = await fixture(t);
  const categories = Array.from({ length: 150 }, (_, index) => ({
    id: `${index}${"界".repeat(97)}`, name: "界".repeat(100), color: "#123456", icon: "Coffee",
  }));
  assert.deepEqual((await settings(await request("/settings", "PUT", { categories }))).categories, categories);
  const badJson = await fetch(`${url}/settings`, { method: "PUT", headers: { Origin: origin, Authorization: `Bearer ${tokens[0]}`, "Content-Type": "application/json" }, body: "{" });
  assert.equal(badJson.status, 400);
  assert.equal((await request("/settings", "PUT", { avatar: "a".repeat(150000) })).status, 413);
  store.fail = true;
  for (const [path, method, body] of [["/settings", "GET", undefined], ["/settings", "PUT", {}], ["/spendings", "GET", undefined], ["/spendings", "POST", input],
      ["/incomes", "GET", undefined], ["/incomes", "POST", incomeInput],
      [`/incomes/${randomUUID()}`, "PUT", incomeInput], [`/incomes/${randomUUID()}`, "DELETE", undefined]] as const) {
    const response = await request(path, method, body);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Service temporarily unavailable" });
  }
});

async function createdIncome(response: Response): Promise<Income> {
  assert.equal(response.status, 201);
  const body = await response.json() as { income: Income };
  assert.deepEqual(Object.keys(body), ["income"]);
  assert.deepEqual(Object.keys(body.income).sort(), ["amount", "endDate", "frequency", "id", "name", "source", "startDate"]);
  assert.match(body.income.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(typeof body.income.amount, "number");
  return body.income;
}

async function incomePage(response: Response): Promise<IncomePage> {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as IncomePage;
  assert.deepEqual(Object.keys(body).sort(), ["incomes", "nextCursor"]);
  return body;
}

test("income CRUD is unseeded, owner-scoped and independent of settings and categories", async t => {
  const { request, users, store } = await fixture(t);
  assert.deepEqual(await incomePage(await request("/incomes")), { incomes: [], nextCursor: null });
  assert.equal(store.settings.size, 0, "income reads must not initialize settings");
  const initial = await settings(await request("/settings", "PUT", { categories: [] }));
  const first = await createdIncome(await request(`/incomes?userId=${users[1].id}`, "POST", { ...incomeInput, source: "  Salary  ", name: " Company " }));
  assert.deepEqual(first, { id: first.id, ...incomeInput });
  const second = await createdIncome(await request("/incomes", "POST", { source: "Gift", amount: 50, frequency: "once", startDate: "2024-03-08" }));
  assert.deepEqual(second, { id: second.id, source: "Gift", name: "", amount: 50, frequency: "once", startDate: "2024-03-08", endDate: null });
  assert.notEqual(first.id, second.id);
  assert.deepEqual(await incomePage(await request("/incomes", "GET", undefined, 1)), { incomes: [], nextCursor: null });
  const path = `/incomes/${first.id}`;
  assert.equal((await request(path, "PUT", incomeInput, 1)).status, 404);
  assert.equal((await request(path, "DELETE", undefined, 1)).status, 404);
  const changed: IncomeInput = { source: "Freelance", name: "", amount: 0.29, frequency: "weekly", startDate: "2025-12-01", endDate: "2026-06-30" };
  const updated = await request(`/incomes/${first.id.toUpperCase()}`, "PUT", changed);
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { income: { id: first.id, ...changed } });
  assert.deepEqual((await incomePage(await request("/incomes"))).incomes, [{ id: first.id, ...changed }, second].sort((a, b) => a.id < b.id ? -1 : 1));
  for (const id of ["not-a-uuid", randomUUID()]) {
    assert.equal((await request(`/incomes/${id}`, "PUT", incomeInput)).status, 404);
    assert.equal((await request(`/incomes/${id}`, "DELETE")).status, 404);
  }
  assert.equal((await request("/incomes", "PUT", incomeInput)).status, 404);
  assert.equal((await request("/incomes", "DELETE")).status, 404);
  const deleted = await request(path, "DELETE");
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), "");
  assert.equal((await request(path, "DELETE")).status, 404);
  assert.equal((await request(path, "PUT", incomeInput)).status, 404);
  assert.deepEqual(await incomePage(await request("/incomes")), { incomes: [second], nextCursor: null });
  assert.deepEqual(await settings(await request("/settings")), initial);
  assert.deepEqual(await (await request("/spendings")).json(), { spendings: [], nextCursor: null });
});

test("income input is strict: required source, known frequency, real dates, positive cents, end date rules", async t => {
  const { request } = await fixture(t);
  const income = await createdIncome(await request("/incomes", "POST", incomeInput));
  const bodies: unknown[] = [null, [], {}, "invalid"];
  for (const field of ["source", "amount", "frequency", "startDate"]) {
    const body = { ...incomeInput } as Record<string, unknown>;
    delete body[field];
    bodies.push(body);
  }
  for (const field of ["id", "userId", "user_id", "month", "description", "category", "extra"]) bodies.push({ ...incomeInput, [field]: randomUUID() });
  for (const source of ["", "   ", "a".repeat(101), null, 1, "bad\ntext", "bad\u0000text"]) bodies.push({ ...incomeInput, source });
  for (const name of ["a".repeat(501), null, 1, "bad\ttext"]) bodies.push({ ...incomeInput, name });
  for (const amount of [0, -0, -1, 1e12 + 0.01, 0.001, 1e-7, "1", null, NaN, Infinity, -Infinity]) bodies.push({ ...incomeInput, amount });
  for (const frequency of ["", "hourly", "Monthly", "biweekly", null, 1]) bodies.push({ ...incomeInput, frequency });
  for (const startDate of ["2023-02-29", "2024-02-30", "0000-01-01", "2024-1-01", "2024-02", "", null]) bodies.push({ ...incomeInput, startDate });
  for (const endDate of ["2024-02-28", "2024-02-30", "2024-03", "", 20240301]) bodies.push({ ...incomeInput, endDate });
  bodies.push({ ...incomeInput, frequency: "once", endDate: "2024-03-01" });
  for (const body of bodies) {
    assert.equal((await request("/incomes", "POST", body)).status, 400, JSON.stringify(body));
    assert.equal((await request(`/incomes/${income.id}`, "PUT", body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(await incomePage(await request("/incomes")), { incomes: [income], nextCursor: null });
  for (const frequency of ["once", "daily", "weekly", "monthly", "yearly"] as const) {
    for (const startDate of ["0001-01-01", "9999-12-31"]) {
      const body: IncomeInput = { source: "a".repeat(100), name: "a".repeat(500), amount: 1e12, frequency, startDate, endDate: null };
      const boundary = await createdIncome(await request("/incomes", "POST", body));
      assert.deepEqual(boundary, { id: boundary.id, ...body });
    }
  }
  const sameDay = await createdIncome(await request("/incomes", "POST", { ...incomeInput, endDate: incomeInput.startDate }));
  assert.equal(sameDay.endDate, incomeInput.startDate);
  const minimum = await createdIncome(await request("/incomes", "POST", { ...incomeInput, amount: 0.01, source: " x ", name: "   ", endDate: null }));
  assert.deepEqual([minimum.source, minimum.name, minimum.amount], ["x", "", 0.01]);
  for (const amount of [NaN, Infinity, -Infinity]) assert.throws(() => validateIncome({ ...incomeInput, amount }), /Invalid amount/);
});

test("income UUID pagination is complete, scoped and supports deleted/cross-user cursors", async t => {
  const { request, store, users } = await fixture(t);
  const ids = Array.from({ length: 503 }, () => randomUUID()).sort();
  for (const id of ids) store.incomeRows(users[0].id).set(id, { id, ...incomeInput });
  const otherId = randomUUID();
  store.incomeRows(users[1].id).set(otherId, { id: otherId, ...incomeInput });
  const first = await incomePage(await request("/incomes"));
  assert.deepEqual(first.incomes.map(row => row.id), ids.slice(0, 500));
  assert.equal(first.nextCursor, ids[499]);
  const second = await incomePage(await request(`/incomes?limit=500&cursor=${first.nextCursor}`));
  assert.deepEqual(second.incomes.map(row => row.id), ids.slice(500));
  assert.equal(second.nextCursor, null);
  const retrieved: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await incomePage(await request(`/incomes?limit=37${cursor ? `&cursor=${cursor}` : ""}`));
    retrieved.push(...page.incomes.map(row => row.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(retrieved, ids);
  assert.equal((await request(`/incomes/${ids[499]}`, "DELETE")).status, 204);
  assert.deepEqual(await incomePage(await request(`/incomes?cursor=${ids[499].toUpperCase()}`)), second);
  assert.deepEqual((await incomePage(await request(`/incomes?cursor=${otherId}`))).incomes.map(row => row.id), ids.filter(id => id > otherId && id !== ids[499]).slice(0, 500));
  assert.deepEqual(await incomePage(await request("/incomes", "GET", undefined, 1)), { incomes: [{ id: otherId, ...incomeInput }], nextCursor: null });
  assert.deepEqual(await incomePage(await request(`/incomes?cursor=${ids[502]}`)), { incomes: [], nextCursor: null });
  for (const query of ["limit=0", "limit=501", "limit=-1", "limit=1.5", "limit=01", "limit=", "limit=1&limit=2", "limit[x]=2", "cursor=bad", "cursor=", `cursor=${ids[0]}&cursor=${ids[1]}`, "cursor[x]=x"]) {
    assert.equal((await request(`/incomes?${query}`)).status, 400, query);
  }
});

test("the removed income-entries API is no longer served", async t => {
  const { request } = await fixture(t);
  assert.equal((await request("/income-entries")).status, 404);
  assert.equal((await request("/income-entries", "POST", { month: "2024-02", amount: 1, description: "Bonus" })).status, 404);
});

test("income writes use the existing origin guard and CORS", async t => {
  const { request, url, tokens } = await fixture(t);
  for (const method of ["POST", "PUT", "DELETE"]) {
    const path = method === "POST" ? "/incomes" : `/incomes/${randomUUID()}`;
    for (const Origin of ["", "https://evil.example"]) {
      assert.equal((await request(path, method, method === "DELETE" ? undefined : incomeInput, 0, { Origin })).status, 403);
    }
    const missingOrigin = await fetch(`${url}${path}`, { method, headers: { Authorization: `Bearer ${tokens[0]}`, "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(incomeInput) });
    assert.notEqual(missingOrigin.status, 403);
    assert.ok(missingOrigin.status < 500);
    const missingOriginWithCookie = await fetch(`${url}${path}`, { method, headers: { Authorization: `Bearer ${tokens[0]}`, Cookie: "session=1", "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(incomeInput) });
    assert.equal(missingOriginWithCookie.status, 403);
    const preflight = await fetch(`${url}${path}`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": method } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.ok(preflight.headers.get("access-control-allow-methods")!.includes(method));
  }
});

const repeatInput: RepeatRuleInput = {
  amount: 25.5,
  description: "Breakfast",
  category: "Food",
  startDate: "2026-10-11",
  time: "08:00",
  frequency: "daily",
  interval: 1,
  endType: "unlimited",
};

test("repeat rule routes require opaque bearer auth and origin guard", async t => {
  const { request, url, tokens } = await fixture(t);
  for (const [path, method, body] of [
    ["/repeat-rules", "GET", undefined],
    ["/repeat-rules", "POST", repeatInput],
    [`/repeat-rules/${randomUUID()}`, "DELETE", undefined],
    ["/repeat-rules/sync", "POST", {}],
  ] as const) {
    assert.equal((await request(path, method, body, 0, { Authorization: "" })).status, 401);
    assert.equal((await request(path, method, body, 0, { Authorization: "Bearer bad" })).status, 401);
  }
  for (const method of ["POST", "DELETE"]) {
    const path = method === "POST" ? "/repeat-rules" : `/repeat-rules/${randomUUID()}`;
    assert.equal((await request(path, method, method === "DELETE" ? undefined : repeatInput, 0, { Origin: "https://evil.example" })).status, 403);
    const missingOrigin = await fetch(`${url}${path}`, { method, headers: { Authorization: `Bearer ${tokens[0]}`, "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(repeatInput) });
    assert.notEqual(missingOrigin.status, 403);
    assert.ok(missingOrigin.status < 500);
    const missingOriginWithCookie = await fetch(`${url}${path}`, { method, headers: { Authorization: `Bearer ${tokens[0]}`, Cookie: "session=1", "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(repeatInput) });
    assert.equal(missingOriginWithCookie.status, 403);
  }
});

test("repeat rule CRUD, cap 100 repeats, and incremental auto-apply tracking", async t => {
  const { request } = await fixture(t);
  // Create unlimited daily repeat rule (cap 100)
  const res = await request("/repeat-rules", "POST", repeatInput);
  assert.equal(res.status, 201);
  const created = await res.json() as { repeatRule: RepeatRule; spendings: Spending[] };
  assert.equal(created.repeatRule.description, "Breakfast");
  assert.equal(created.repeatRule.occurrencesCreated, 100);
  assert.equal(created.spendings.length, 100);
  assert.equal(created.spendings[0].date, "2026-10-11");
  assert.equal(created.spendings[0].repeatRuleId, created.repeatRule.id);

  // Listing repeat rules returns the rule
  const listRes = await request("/repeat-rules");
  assert.equal(listRes.status, 200);
  const rules = (await listRes.json() as { repeatRules: RepeatRule[] }).repeatRules;
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, created.repeatRule.id);

  // Listing spendings returns the 100 generated spendings
  const spendingsRes = await request("/spendings");
  const spendingsList = (await spendingsRes.json() as { spendings: Spending[] }).spendings;
  assert.equal(spendingsList.length, 100);

  // Time advances near the repeat horizon: auto-apply generates next 100 repeats
  const horizonNear = created.repeatRule.lastGeneratedDate!; // exactly on the horizon
  const syncRes = await request("/repeat-rules/sync", "POST", { asOfDate: horizonNear });
  assert.equal(syncRes.status, 200);
  const syncData = await syncRes.json() as { spendingsCreated: number };
  assert.equal(syncData.spendingsCreated, 100);

  // Now 200 spendings exist
  const updatedRules = (await (await request("/repeat-rules")).json() as { repeatRules: RepeatRule[] }).repeatRules;
  assert.equal(updatedRules[0].occurrencesCreated, 200);

  // Bounded rule (e.g. 10 occurrences)
  const boundedRes = await request("/repeat-rules", "POST", {
    amount: 15.0,
    description: "Gas",
    category: "Transport",
    startDate: "2026-10-15",
    time: "09:00",
    frequency: "weekly",
    endType: "occurrences",
    totalOccurrences: 10,
  });
  assert.equal(boundedRes.status, 201);
  const bounded = await boundedRes.json() as { repeatRule: RepeatRule; spendings: Spending[] };
  assert.equal(bounded.spendings.length, 10);
  assert.equal(bounded.repeatRule.occurrencesCreated, 10);

  // Delete rule: removes rule
  const delRes = await request(`/repeat-rules/${bounded.repeatRule.id}`, "DELETE");
  assert.equal(delRes.status, 204);
  assert.equal((await request(`/repeat-rules/${bounded.repeatRule.id}`, "DELETE")).status, 404);
});

test("repeat rule strict validation rejects invalid inputs and capped at 100", async t => {
  const { request } = await fixture(t);
  // Cap at 100 repeats: occurrences > 100 must be rejected
  assert.equal((await request("/repeat-rules", "POST", { ...repeatInput, endType: "occurrences", totalOccurrences: 101 })).status, 400);
  assert.equal((await request("/repeat-rules", "POST", { ...repeatInput, endType: "occurrences", totalOccurrences: 0 })).status, 400);
  // Invalid frequency
  assert.equal((await request("/repeat-rules", "POST", { ...repeatInput, frequency: "yearly" })).status, 400);
  // Invalid interval
  assert.equal((await request("/repeat-rules", "POST", { ...repeatInput, interval: 0 })).status, 400);
  assert.equal((await request("/repeat-rules", "POST", { ...repeatInput, interval: 366 })).status, 400);
  // Invalid end date before start date
  assert.equal((await request("/repeat-rules", "POST", { ...repeatInput, endType: "until_date", endDate: "2026-10-10" })).status, 400);
  // Category not in settings
  assert.equal((await request("/repeat-rules", "POST", { ...repeatInput, category: "NonExistent" })).status, 400);
});

const lunchPlan = {
  amount: 35000, description: "Lunch", category: "Food", time: "12:30",
  startDate: "2026-11-02", frequency: "weekdays", interval: 1, daysOfWeek: [], endDate: null,
};

test("plans project the future and only become real spendings once their local time passes", async t => {
  const { request, store } = await fixture(t);
  // 05:00 UTC = 12:00 in the default Asia/Ho_Chi_Minh time zone, Wednesday 2026-11-04.
  store.planStore.now = () => new Date("2026-11-04T05:00:00Z");

  const createdRes = await request("/plans", "POST", lunchPlan);
  assert.equal(createdRes.status, 201);
  const plan = (await createdRes.json() as { plan: Plan }).plan;
  assert.equal(plan.materializedThrough, "2026-11-04T12:00");
  assert.deepEqual(plan.exceptions, []);
  // Monday's and Tuesday's lunches are in the past: a new plan never back-fills them.
  const noneYet = await (await request("/spendings")).json() as { spendings: Spending[] };
  assert.equal(noneYet.spendings.length, 0);

  // Skip Thursday, change Friday; weekends and already-real dates are rejected.
  const skip = await request(`/plans/${plan.id}/exceptions/2026-11-05`, "PUT", { kind: "skip" });
  assert.equal(skip.status, 200);
  const override = await request(`/plans/${plan.id}/exceptions/2026-11-06`, "PUT", { kind: "override", amount: 50000, description: "Team lunch" });
  assert.deepEqual((await override.json() as { plan: Plan }).plan.exceptions, [
    { date: "2026-11-05", kind: "skip", amount: null, description: null },
    { date: "2026-11-06", kind: "override", amount: 50000, description: "Team lunch" },
  ]);
  assert.equal((await request(`/plans/${plan.id}/exceptions/2026-11-07`, "PUT", { kind: "skip" })).status, 400);
  assert.equal((await request(`/plans/${plan.id}/exceptions/2026-11-03`, "PUT", { kind: "skip" })).status, 400);
  assert.equal((await request(`/plans/${plan.id}/exceptions/2026-11-06`, "PUT", { kind: "skip", amount: 1 })).status, 400);

  // Next Monday 13:00 local: Wed, (skipped Thu), Fri override and Mon have passed.
  store.planStore.now = () => new Date("2026-11-09T06:00:00Z");
  const real = (await (await request("/spendings")).json() as { spendings: Spending[] }).spendings
    .sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(real.map(row => [row.date, row.time, row.amount, row.description, row.planId, row.planDate]), [
    ["2026-11-04", "12:30", 35000, "Lunch", plan.id, "2026-11-04"],
    ["2026-11-06", "12:30", 50000, "Team lunch", plan.id, "2026-11-06"],
    ["2026-11-09", "12:30", 35000, "Lunch", plan.id, "2026-11-09"],
  ]);
  // Reading again never duplicates, and a deleted occurrence ("didn't happen") is not recreated.
  assert.equal((await request(`/spendings/${real[1].id}`, "DELETE")).status, 204);
  const again = (await (await request("/spendings")).json() as { spendings: Spending[] }).spendings;
  assert.equal(again.length, 2);
  const listed = (await (await request("/plans")).json() as { plans: Plan[] }).plans;
  assert.equal(listed[0].materializedThrough, "2026-11-09T13:00");
  assert.deepEqual(listed[0].exceptions, []);
  // Editing a materialized spending keeps its link to the plan.
  const edited = await request(`/spendings/${real[0].id}`, "PUT", { amount: 42000, description: "Lunch", category: "Food", date: "2026-11-04", time: "12:30" });
  assert.equal((await edited.json() as { spending: Spending }).spending.planId, plan.id);

  // Another user sees none of it.
  assert.deepEqual((await (await request("/plans", "GET", undefined, 1)).json() as { plans: Plan[] }).plans, []);
  assert.equal((await request(`/plans/${plan.id}`, "DELETE", undefined, 1)).status, 404);
});

test("plans support edit, split (this and future), delete, and strict validation", async t => {
  const { request, store } = await fixture(t);
  store.planStore.now = () => new Date("2026-11-04T05:00:00Z");
  const plan = (await (await request("/plans", "POST", lunchPlan)).json() as { plan: Plan }).plan;

  const updated = await request(`/plans/${plan.id}`, "PUT", { ...lunchPlan, amount: 38000 });
  assert.equal((await updated.json() as { plan: Plan }).plan.amount, 38000);
  assert.equal((await request(`/plans/${plan.id}/exceptions/2026-11-20`, "PUT", { kind: "skip" })).status, 200);

  const splitRes = await request(`/plans/${plan.id}/split`, "POST", { ...lunchPlan, amount: 40000, startDate: "2026-11-16" });
  assert.equal(splitRes.status, 201);
  const split = await splitRes.json() as { ended: Plan; created: Plan };
  assert.equal(split.ended.endDate, "2026-11-15");
  assert.equal(split.created.startDate, "2026-11-16");
  assert.equal(split.created.amount, 40000);
  assert.deepEqual(split.created.exceptions.map(item => item.date), ["2026-11-20"]);
  assert.deepEqual(split.ended.exceptions, []);
  assert.equal((await request(`/plans/${plan.id}/split`, "POST", { ...lunchPlan, startDate: "2026-11-01" })).status, 400);

  assert.equal((await request(`/plans/${plan.id}`, "DELETE")).status, 204);
  assert.equal((await request(`/plans/${plan.id}`, "DELETE")).status, 404);
  assert.equal((await request(`/plans/${plan.id}`, "PUT", lunchPlan)).status, 404);
  assert.equal((await request("/plans/not-a-uuid", "DELETE")).status, 404);

  for (const bad of [
    { ...lunchPlan, frequency: "yearly" },
    { ...lunchPlan, amount: 0 },
    { ...lunchPlan, time: "25:00" },
    { ...lunchPlan, frequency: "once", endDate: "2026-12-01" },
    { ...lunchPlan, endDate: "2026-11-01" },
    { ...lunchPlan, interval: 0 },
    { ...lunchPlan, daysOfWeek: [7] },
    { ...lunchPlan, extra: true },
  ]) assert.equal((await request("/plans", "POST", bad)).status, 400, JSON.stringify(bad));
  assert.equal((await request("/plans", "POST", { ...lunchPlan, category: "Nope" })).status, 400);
});

test("settings time zone is validated and drives plan materialization", async t => {
  const { request, store } = await fixture(t);
  assert.equal((await request("/settings", "PUT", { timezone: "Mars/Base" })).status, 400);
  const saved = await request("/settings", "PUT", { timezone: "UTC" });
  assert.equal((await saved.json() as { settings: FinanceSettings }).settings.timezone, "UTC");
  store.planStore.now = () => new Date("2026-11-04T05:00:00Z");
  const plan = (await (await request("/plans", "POST", lunchPlan)).json() as { plan: Plan }).plan;
  assert.equal(plan.materializedThrough, "2026-11-04T05:00");
});

test("plans can be commitments and an upcoming occurrence can be recorded as done now", async t => {
  const { request, store } = await fixture(t);
  store.planStore.now = () => new Date("2026-11-04T05:00:00Z"); // Wed 12:00 local
  const rent = (await (await request("/plans", "POST", { ...lunchPlan, description: "Rent", amount: 4000000, frequency: "monthly", startDate: "2026-11-05", time: "08:00", sure: true })).json() as { plan: Plan }).plan;
  assert.equal(rent.sure, true);
  assert.equal((await request("/plans", "POST", { ...lunchPlan, sure: "yes" })).status, 400);
  const lunch = (await (await request("/plans", "POST", lunchPlan)).json() as { plan: Plan }).plan;
  assert.equal(lunch.sure, false);

  // Paying Friday's lunch early lands on "now" but stays linked to Friday's occurrence.
  const done = await request(`/plans/${lunch.id}/occurrences/2026-11-06/done`, "POST");
  assert.equal(done.status, 201);
  const spending = (await done.json() as { spending: Spending }).spending;
  assert.deepEqual([spending.date, spending.time, spending.planId, spending.planDate, spending.amount], ["2026-11-04", "12:00", lunch.id, "2026-11-06", 35000]);
  // It can't be done twice, and later materialization doesn't add it again.
  assert.equal((await request(`/plans/${lunch.id}/occurrences/2026-11-06/done`, "POST")).status, 400);
  assert.equal((await request(`/plans/${lunch.id}/occurrences/2026-11-07/done`, "POST")).status, 400);
  store.planStore.now = () => new Date("2026-11-06T06:00:00Z");
  const rows = (await (await request("/spendings")).json() as { spendings: Spending[] }).spendings.filter(row => row.planId === lunch.id);
  assert.deepEqual(rows.map(row => row.planDate).sort(), ["2026-11-04", "2026-11-05", "2026-11-06"]);
  assert.equal((await request(`/plans/${randomUUID()}/occurrences/2026-11-06/done`, "POST")).status, 404);
});

type Json = Record<string, unknown>;
const weeklyPay: IncomeInput = { source: "Salary", name: "Shop", amount: 500, frequency: "weekly", startDate: "2026-01-02", endDate: null };

async function rawIncome(response: Response): Promise<Income> {
  assert.equal(response.status, 201);
  return (await response.json() as { income: Income }).income;
}

async function incomeId(request: (path: string, method?: string, body?: unknown, user?: number) => Promise<Response>, body: unknown, user = 0): Promise<string> {
  const response = await request("/incomes", "POST", body, user);
  assert.equal(response.status, 201);
  return (await response.json() as { income: Income }).income.id;
}

test("income pay schedule fields round trip, defaults are omitted and bad combinations are rejected", async t => {
  const { request } = await fixture(t);
  // An old payload round trips with no new keys, and explicit defaults are normalized away.
  const plain = await createdIncome(await request("/incomes", "POST", { ...incomeInput, interval: 1, weekendShift: false }));
  assert.deepEqual(plain, { id: plain.id, ...incomeInput });
  const biweekly = await rawIncome(await request("/incomes", "POST", { ...weeklyPay, interval: 2, weekendShift: true }));
  assert.deepEqual(biweekly, { id: biweekly.id, ...weeklyPay, interval: 2, weekendShift: true });
  const twice = await rawIncome(await request("/incomes", "POST", { ...incomeInput, frequency: "semimonthly", semimonthlyDays: [15, 31], weekendShift: true }));
  assert.deepEqual(twice.semimonthlyDays, [15, 31]);
  assert.equal(twice.weekendShift, true);
  const updated = await request(`/incomes/${twice.id}`, "PUT", { ...incomeInput, frequency: "semimonthly", semimonthlyDays: [1, 16] });
  assert.deepEqual(((await updated.json()) as { income: Income }).income, { id: twice.id, ...incomeInput, frequency: "semimonthly", semimonthlyDays: [1, 16] });

  const bad: unknown[] = [
    { ...weeklyPay, interval: 3 }, { ...weeklyPay, interval: 0 }, { ...weeklyPay, interval: 8 }, { ...weeklyPay, interval: "2" },
    { ...incomeInput, interval: 2 },
    { ...incomeInput, frequency: "semimonthly" },
    ...[[31, 15], [15, 15], [0, 5], [1, 32], [1.5, 20], ["1", "2"], [1], [1, 2, 3]].map(days => ({ ...incomeInput, frequency: "semimonthly", semimonthlyDays: days })),
    { ...incomeInput, semimonthlyDays: [1, 15] },
    { ...incomeInput, frequency: "once", weekendShift: true }, { ...incomeInput, frequency: "daily", weekendShift: true },
    { ...incomeInput, weekendShift: "yes" }, { ...incomeInput, weekendShift: null },
    { ...incomeInput, unknown: 1 },
  ];
  for (const body of bad) assert.equal((await request("/incomes", "POST", body)).status, 400, JSON.stringify(body));
  assert.equal((await request("/incomes", "POST", { ...incomeInput, weekendShift: true })).status, 201);
});

test("budget period settings validate, guard the paycheck income and reset when it is deleted", async t => {
  const { request, store, users } = await fixture(t);
  const put = (budgetPeriod: unknown) => request("/settings", "PUT", { budgetPeriod });
  assert.deepEqual((await settings(await request("/settings"))).budgetPeriod, { mode: "calendar", startDay: 1, paycheckIncomeId: null });
  assert.deepEqual((await settings(await put({ mode: "monthly_from_day", startDay: 25 }))).budgetPeriod, { mode: "monthly_from_day", startDay: 25, paycheckIncomeId: null });

  for (const body of [{ startDay: 0 }, { startDay: 29 }, { startDay: 1.5 }, { startDay: "5" }, { mode: "weekly" }, { extra: 1 },
    { mode: "paycheck", paycheckIncomeId: null }, { paycheckIncomeId: "nope" }, "text", null]) {
    assert.equal((await put(body)).status, 400, JSON.stringify(body));
  }
  // Paycheck mode needs one of the user's own weekly, twice-a-month or monthly incomes.
  assert.equal((await put({ mode: "paycheck" })).status, 400);
  assert.equal((await put({ mode: "paycheck", paycheckIncomeId: randomUUID() })).status, 400);
  const foreign = await incomeId(request, weeklyPay, 1);
  assert.equal((await put({ mode: "paycheck", paycheckIncomeId: foreign })).status, 400);
  const daily = await incomeId(request, { ...weeklyPay, frequency: "daily" });
  assert.equal((await put({ mode: "paycheck", paycheckIncomeId: daily })).status, 400);
  assert.equal(store.settings.get(users[0].id)!.budgetPeriod.mode, "monthly_from_day", "a rejected patch writes nothing");

  const pay = await incomeId(request, weeklyPay);
  assert.deepEqual((await settings(await put({ mode: "paycheck", paycheckIncomeId: pay }))).budgetPeriod, { mode: "paycheck", startDay: 25, paycheckIncomeId: pay });
  // An absent sub-key keeps the stored id, and an explicit null clears it.
  assert.equal((await settings(await put({ startDay: 3 }))).budgetPeriod.paycheckIncomeId, pay);
  assert.equal((await put({ paycheckIncomeId: null })).status, 400, "paycheck mode without an income");
  assert.deepEqual((await settings(await put({ mode: "calendar", paycheckIncomeId: null }))).budgetPeriod, { mode: "calendar", startDay: 3, paycheckIncomeId: null });
  await settings(await put({ mode: "paycheck", paycheckIncomeId: pay }));

  // The chosen income can change freely except to a frequency that cannot be a paycheck.
  assert.equal((await request(`/incomes/${pay}`, "PUT", { ...weeklyPay, amount: 600, frequency: "monthly" })).status, 200);
  for (const frequency of ["daily", "once", "yearly"]) {
    assert.equal((await request(`/incomes/${pay}`, "PUT", { ...weeklyPay, frequency, endDate: null })).status, 400, frequency);
  }
  assert.equal((await request(`/incomes/${daily}`, "PUT", { ...weeklyPay, frequency: "yearly" })).status, 200, "other incomes change freely");

  // Deleting another income leaves the setting alone, deleting the paycheck income resets it.
  assert.equal((await request(`/incomes/${daily}`, "DELETE")).status, 204);
  assert.equal((await settings(await request("/settings"))).budgetPeriod.mode, "paycheck");
  assert.equal((await request(`/incomes/${pay}`, "DELETE")).status, 204);
  assert.deepEqual((await settings(await request("/settings"))).budgetPeriod, { mode: "calendar", startDay: 3, paycheckIncomeId: null });
});

test("GET /plans/summary is routed before the plan id matcher and sums one budget period", async t => {
  const { request, store } = await fixture(t);
  store.planStore.now = () => new Date("2026-11-04T05:00:00Z");
  await request("/settings", "PUT", { timezone: "UTC" });
  const pay = await incomeId(request, { source: "Salary", name: "", amount: 1000, frequency: "monthly", startDate: "2026-01-25", endDate: null });
  assert.equal((await request("/settings", "PUT", { budgetPeriod: { mode: "paycheck", paycheckIncomeId: pay } })).status, 200);
  const rent = { ...lunchPlan, description: "Rent", amount: 400, frequency: "monthly", startDate: "2026-11-01", time: "08:00", sure: true };
  assert.equal((await request("/plans", "POST", rent)).status, 201);
  assert.equal((await request("/plans", "POST", { ...lunchPlan, description: "Coffee", amount: 50, frequency: "once", startDate: "2026-12-10", time: "09:00" })).status, 201);

  const response = await request("/plans/summary?date=2026-12-10");
  assert.equal(response.status, 200);
  const { summary } = await response.json() as { summary: Json & { occurrences: { description: string; date: string }[]; period: Json; payments: Json[] } };
  assert.deepEqual(summary.period, { start: "2026-11-25", end: "2026-12-24", nextStart: "2026-12-25", mode: "paycheck" });
  assert.deepEqual(summary.payments.map(payment => payment.date), ["2026-11-25"]);
  // The bill due on the 1st belongs to the paycheck before it.
  assert.deepEqual(summary.occurrences.map(item => [item.description, item.date]), [["Rent", "2026-12-01"], ["Coffee", "2026-12-10"]]);
  assert.deepEqual([summary.income, summary.spent, summary.committed, summary.tentative, summary.left], [1000, 0, 400, 50, 550]);

  // No date means today in the saved time zone.
  const now = (await (await request("/plans/summary")).json() as { summary: { today: string; period: { start: string; end: string } } }).summary;
  assert.equal(now.today, new Date().toISOString().slice(0, 10));
  assert.ok(now.period.start <= now.today && now.today <= now.period.end);

  assert.equal((await request("/plans/summary?date=2026-13-40")).status, 400);
  assert.equal((await request("/plans/summary?date=nope")).status, 400);
  assert.equal((await request("/plans/summary", "POST", {})).status, 404);
  assert.equal((await request("/plans/summary", "DELETE")).status, 404);
  // Plan ids still route to the plan.
  assert.equal((await request(`/plans/${randomUUID()}`, "PUT", lunchPlan)).status, 404);
  assert.equal((await request("/plans/summary?date=2026-12-10", "GET", undefined, 1)).status, 200);
});

test("leaving paycheck mode clears the paycheck income, so editing or deleting it later changes nothing else", async t => {
  const { request, store, users } = await fixture(t);
  const pay = await incomeId(request, weeklyPay);
  assert.equal((await request("/settings", "PUT", { budgetPeriod: { mode: "paycheck", paycheckIncomeId: pay } })).status, 200);
  // Switch without sending paycheckIncomeId: the id is cleared with the mode.
  const left = await settings(await request("/settings", "PUT", { budgetPeriod: { mode: "monthly_from_day", startDay: 10 } }));
  assert.deepEqual(left.budgetPeriod, { mode: "monthly_from_day", startDay: 10, paycheckIncomeId: null });
  assert.equal((await request(`/incomes/${pay}`, "PUT", { ...weeklyPay, frequency: "daily" })).status, 200, "no longer guarded");
  assert.equal((await request(`/incomes/${pay}`, "DELETE")).status, 204);
  assert.deepEqual((await settings(await request("/settings"))).budgetPeriod, { mode: "monthly_from_day", startDay: 10, paycheckIncomeId: null });
  // A stored paycheck mode without an income never blocks other settings writes.
  store.settings.get(users[0].id)!.budgetPeriod = { mode: "paycheck", startDay: 1, paycheckIncomeId: null };
  assert.equal((await request("/settings", "PUT", { avatar: "https://example.test/a.png" })).status, 200);
});

test("an occurrence marked done early is not projected again in the period of its plan date", async t => {
  const { request, store } = await fixture(t);
  store.planStore.now = () => new Date("2026-11-04T05:00:00Z");
  await request("/settings", "PUT", { timezone: "UTC", budgetPeriod: { mode: "monthly_from_day", startDay: 5 } });
  const rent = (await (await request("/plans", "POST", { ...lunchPlan, description: "Rent", amount: 400, frequency: "monthly", startDate: "2026-11-05", time: "08:00", sure: true })).json() as { plan: Plan }).plan;
  const before = (await (await request("/plans/summary?date=2026-11-05")).json() as { summary: { committed: number } }).summary;
  assert.equal(before.committed, 400);
  assert.equal((await request(`/plans/${rent.id}/occurrences/2026-11-05/done`, "POST")).status, 201);
  // The spending is dated 2026-11-04 (previous period) but belongs to the plan date 2026-11-05.
  const next = (await (await request("/plans/summary?date=2026-11-05")).json() as { summary: { committed: number; spent: number; left: number; period: { start: string } } }).summary;
  assert.deepEqual([next.period.start, next.committed, next.spent], ["2026-11-05", 0, 0]);
  const prior = (await (await request("/plans/summary?date=2026-11-04")).json() as { summary: { spent: number; committed: number } }).summary;
  assert.deepEqual([prior.spent, prior.committed], [400, 0], "counted once, in the period it was paid");
});

test("showBy defaults to calendar_month, accepts only its two values and survives other changes", async t => {
  const { request, store, users } = await fixture(t);
  const put = (body: unknown) => request("/settings", "PUT", body);
  assert.equal((await settings(await request("/settings"))).showBy, "calendar_month");
  assert.equal((await settings(await put({ showBy: "pay_cycle" }))).showBy, "pay_cycle");
  assert.equal((await settings(await put({ showBy: "calendar_month" }))).showBy, "calendar_month");
  await put({ showBy: "pay_cycle" });

  for (const showBy of ["weekly", "", "Pay cycle", 1, null, true, {}, []]) {
    assert.equal((await put({ showBy })).status, 400, JSON.stringify(showBy));
  }
  assert.equal(store.settings.get(users[0].id)!.showBy, "pay_cycle", "a rejected patch writes nothing");

  // A patch without showBy leaves it alone, including a budget period change.
  assert.equal((await settings(await put({ timezone: "UTC" }))).showBy, "pay_cycle");
  const updated = await settings(await put({ budgetPeriod: { mode: "monthly_from_day", startDay: 25 }, showBy: "calendar_month" }));
  assert.deepEqual([updated.showBy, updated.budgetPeriod.mode, updated.budgetPeriod.startDay], ["calendar_month", "monthly_from_day", 25], "one PUT carries both");
  assert.equal((await settings(await put({ budgetPeriod: { startDay: 3 } }))).showBy, "calendar_month");
  assert.equal((await settings(await request("/settings", "GET", undefined, 1))).showBy, "calendar_month", "another user is unchanged");
});

test("deleting the paycheck income resets the budget period and keeps showBy", async t => {
  const { request } = await fixture(t);
  const income = await request("/incomes", "POST", { source: "Salary", name: "", amount: 1000, frequency: "monthly", startDate: "2026-01-25", endDate: null });
  assert.equal(income.status, 201);
  const pay = (await income.json() as { income: { id: string } }).income.id;
  const saved = await settings(await request("/settings", "PUT", { budgetPeriod: { mode: "paycheck", paycheckIncomeId: pay }, showBy: "pay_cycle" }));
  assert.deepEqual([saved.budgetPeriod.mode, saved.showBy], ["paycheck", "pay_cycle"]);
  assert.equal((await request(`/incomes/${pay}`, "DELETE")).status, 204);
  const after = await settings(await request("/settings"));
  assert.deepEqual([after.budgetPeriod.mode, after.budgetPeriod.paycheckIncomeId, after.showBy], ["calendar", null, "pay_cycle"]);
});

type Transaction = import("../src/server/finance/model").Transaction;

test("ledger: past paydays become income rows on their day; /spendings stays expense-only", async t => {
  const { request, store } = await fixture(t);
  // 01:00 UTC = 08:00 in the default Asia/Ho_Chi_Minh time zone, 2026-11-10.
  store.planStore.now = () => new Date("2026-11-10T01:00:00Z");
  const list = async (query = "") => (await (await request(`/transactions${query}`)).json() as { transactions: Transaction[] }).transactions
    .sort((a, b) => a.date.localeCompare(b.date));

  const salary = await (await request("/incomes", "POST", { source: "Salary", name: "Company", amount: 20000000, frequency: "monthly", startDate: "2026-09-25", endDate: null, weekendShift: true })).json() as { income: Income };
  const gift = await (await request("/incomes", "POST", { source: "Gift", name: "From mom", amount: 500000, frequency: "once", startDate: "2026-11-05", endDate: null })).json() as { income: Income };
  await created(await request("/spendings", "POST", { ...input, date: "2026-11-05" }));

  const all = await list();
  assert.deepEqual(all.map(row => [row.kind, row.date, row.category, row.amount]), [
    ["income", "2026-09-25", "Salary", 20000000],
    ["income", "2026-10-23", "Salary", 20000000], // Sunday 10-25 paid on Friday
    ["expense", "2026-11-05", "Food", 12.34],
    ["income", "2026-11-05", "Gift", 500000],
  ]);
  assert.equal(all[1].incomeId, salary.income.id);
  assert.equal(all[1].incomeDate, "2026-10-25");
  assert.equal(all[1].time, "00:00");
  assert.deepEqual((await list("?kind=income&startDate=2026-11-01&endDate=2026-11-30")).map(row => row.category), ["Gift"]);
  assert.equal((await request("/transactions?kind=transfer")).status, 400);
  // The spendings API never sees income rows.
  const spendings = (await (await request("/spendings")).json() as { spendings: Spending[] }).spendings;
  assert.deepEqual(spendings.map(row => row.category), ["Food"]);

  // Reading again writes nothing twice.
  assert.equal((await list()).length, 4);

  // A raise changes only paydays from now on.
  const raised = await request(`/incomes/${salary.income.id}`, "PUT", { source: "Salary", name: "Company", amount: 25000000, frequency: "monthly", startDate: "2026-09-25", endDate: null, weekendShift: true });
  assert.equal(raised.status, 200);
  store.planStore.now = () => new Date("2026-11-25T01:00:00Z");
  assert.deepEqual((await list("?kind=income")).filter(row => row.category === "Salary").map(row => row.amount), [20000000, 20000000, 25000000]);

  // A late salary is fixed on its own row; an income row takes any source as its category.
  const october = (await list()).find(row => row.date === "2026-10-23")!;
  const fixed = await request(`/transactions/${october.id}`, "PUT", { amount: 19000000, description: "Paid late", category: "Salary", date: "2026-10-27", time: "09:00" });
  assert.equal(fixed.status, 200);
  assert.deepEqual((await fixed.json() as { transaction: Transaction }).transaction.date, "2026-10-27");
  const food = (await list()).find(row => row.kind === "expense")!;
  assert.equal((await request(`/transactions/${food.id}`, "PUT", { amount: 1, description: "", category: "Nope", date: "2026-11-05", time: "12:00" })).status, 400);

  // A deleted payday is not written again.
  const september = (await list()).find(row => row.date === "2026-09-25")!;
  assert.equal((await request(`/transactions/${september.id}`, "DELETE")).status, 204);
  assert.equal((await list("?kind=income")).some(row => row.date === "2026-09-25"), false);

  // Editing a one-time income rewrites its single row.
  const moved = await request(`/incomes/${gift.income.id}`, "PUT", { source: "Gift", name: "From mom", amount: 700000, frequency: "once", startDate: "2026-11-06", endDate: null });
  assert.equal(moved.status, 200);
  assert.deepEqual((await list("?kind=income")).filter(row => row.category === "Gift").map(row => [row.date, row.amount]), [["2026-11-06", 700000]]);

  // Deleting a recurring income keeps what was received; deleting a one-time income removes its row.
  assert.equal((await request(`/incomes/${salary.income.id}`, "DELETE")).status, 204);
  assert.equal((await request(`/incomes/${gift.income.id}`, "DELETE")).status, 204);
  const kept = await list("?kind=income");
  assert.deepEqual(kept.map(row => [row.date, row.incomeId ?? null]), [["2026-10-27", null], ["2026-11-25", null]]);
  assert.equal((await request(`/transactions/${randomUUID()}`, "DELETE")).status, 404);
});
