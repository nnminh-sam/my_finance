import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { createApplication } from "../src/application";
import { hashToken, newToken } from "../src/auth/crypto";
import type { AuthStore, User } from "../src/auth/store";
import { defaultFinanceSettings, type FinanceSettings, type IncomeEntry, type IncomeEntryInput, type IncomeEntryPage, type Spending, type SpendingInput } from "../src/finance/model";
import type { FinanceStore } from "../src/finance/store";
import { incomeEntryInput } from "../src/finance/validation";

class MemoryFinanceStore implements FinanceStore {
  settings = new Map<string, FinanceSettings>();
  spendings = new Map<string, Map<string, Spending>>();
  incomeEntries = new Map<string, Map<string, IncomeEntry>>();
  incomeRows(userId: string) {
    if (!this.incomeEntries.has(userId)) this.incomeEntries.set(userId, new Map());
    return this.incomeEntries.get(userId)!;
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
  async updateSettings(userId: string, patch: Partial<FinanceSettings>) {
    const settings = { ...await this.getSettings(userId), ...structuredClone(patch) };
    this.settings.set(userId, settings);
    return structuredClone(settings);
  }
  async listSpendings(userId: string, limit: number, cursor?: string) {
    this.check();
    const rows = [...this.rows(userId).values()].filter(row => !cursor || row.id > cursor)
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const spendings = rows.slice(0, limit);
    return { spendings: structuredClone(spendings), nextCursor: rows.length > limit ? spendings[spendings.length - 1].id : null };
  }
  async createSpending(userId: string, input: SpendingInput) {
    if (!(await this.getSettings(userId)).categories.some(category => category.id === input.category)) return undefined;
    const spending = { id: randomUUID(), ...input };
    this.rows(userId).set(spending.id, spending);
    return structuredClone(spending);
  }
  async updateSpending(userId: string, id: string, input: SpendingInput) {
    this.check();
    if (!this.rows(userId).has(id)) return "not-found" as const;
    if (!(await this.getSettings(userId)).categories.some(category => category.id === input.category)) return "invalid-category" as const;
    const spending = { id, ...input };
    this.rows(userId).set(id, spending);
    return structuredClone(spending);
  }
  async deleteSpending(userId: string, id: string) { this.check(); return this.rows(userId).delete(id); }
  async listIncomeEntries(userId: string, limit: number, cursor?: string) {
    this.check();
    const rows = [...this.incomeRows(userId).values()].filter(row => !cursor || row.id > cursor)
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const incomeEntries = rows.slice(0, limit);
    return { incomeEntries: structuredClone(incomeEntries), nextCursor: rows.length > limit ? incomeEntries[incomeEntries.length - 1].id : null };
  }
  async createIncomeEntry(userId: string, input: IncomeEntryInput) {
    this.check();
    const incomeEntry = { id: randomUUID(), ...input };
    this.incomeRows(userId).set(incomeEntry.id, incomeEntry);
    return structuredClone(incomeEntry);
  }
  async updateIncomeEntry(userId: string, id: string, input: IncomeEntryInput) {
    this.check();
    if (!this.incomeRows(userId).has(id)) return undefined;
    const incomeEntry = { id, ...input };
    this.incomeRows(userId).set(id, incomeEntry);
    return structuredClone(incomeEntry);
  }
  async deleteIncomeEntry(userId: string, id: string) { this.check(); return this.incomeRows(userId).delete(id); }
}

const origin = "http://localhost:5173";
const input: SpendingInput = { amount: 12.34, description: "Lunch", category: "Food", date: "2024-02-29", time: "12:05" };
const incomeInput: IncomeEntryInput = { month: "2024-02", amount: 100.29, description: "Bonus" };

async function fixture(t: TestContext) {
  const users: User[] = [0, 1].map(index => ({ id: randomUUID(), name: `User ${index}`, email: `${index}@example.test`, createdAt: new Date().toISOString() }));
  const tokens = users.map(() => newToken());
  const hashes = tokens.map(hashToken);
  const authStore: AuthStore = {
    async authenticate(hash) { return users[hashes.indexOf(hash)]; },
    async reserveAttempt() { return true; }, async findAccount() { return undefined; },
    async register() { return undefined; }, async createSession() {}, async rotate() { return undefined; }, async revoke() {},
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
  assert.deepEqual(Object.keys(settings).sort(), ["avatar", "categories", "income"]);
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
    ["/income-entries", "GET", undefined], ["/income-entries", "POST", incomeInput],
    [`/income-entries/${randomUUID()}`, "PUT", incomeInput], [`/income-entries/${randomUUID()}`, "DELETE", undefined],
  ] as const) {
    assert.equal((await request(path, method, body, 0, { Authorization: "" })).status, 401);
    assert.equal((await request(path, method, body, 0, { Authorization: "Bearer invalid" })).status, 401);
    assert.equal((await request(path, method, body, 0, { Authorization: "", Cookie: `mf_refresh=${newToken()}` })).status, 401);
  }
  for (const method of ["PUT", "DELETE"]) {
    const path = method === "PUT" ? "/settings" : `/spendings/${randomUUID()}`;
    assert.equal((await request(path, method, method === "PUT" ? {} : undefined, 0, { Origin: "https://evil.example" })).status, 403);
  }
  const missingOrigin = await fetch(`${url}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(missingOrigin.status, 403);
  const preflight = await fetch(`${url}/settings`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "PUT" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.match(preflight.headers.get("access-control-allow-methods")!, /PUT/);
  assert.match(preflight.headers.get("access-control-allow-methods")!, /DELETE/);
  const response = await request("/settings");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("settings have zero financial defaults, persist partial/full changes, and isolate users", async t => {
  const { request, users, store } = await fixture(t);
  assert.deepEqual(await settings(await request(`/settings?userId=${users[1].id}`)), defaultFinanceSettings());
  assert.deepEqual(await (await request("/spendings")).json(), { spendings: [], nextCursor: null });
  const updated = await settings(await request("/settings", "PUT", { income: 100.29 }));
  assert.equal(updated.income, 100.29);
  assert.deepEqual(updated.categories, defaultFinanceSettings().categories);
  assert.deepEqual(await settings(await request("/settings")), updated);
  assert.deepEqual(await settings(await request("/settings", "GET", undefined, 1)), defaultFinanceSettings());
  const full = { ...updated, avatar: "https://example.test/avatar.png", categories: [{ id: "custom", name: "Custom", color: "#ABCDEF", icon: "Coffee" }] };
  assert.deepEqual(await settings(await request("/settings", "PUT", full)), full);
  assert.deepEqual(await settings(await request("/settings", "PUT", {})), full);
  assert.equal((await settings(await request("/settings", "PUT", { avatar: "" }))).avatar, "");
  assert.equal(store.settings.size, 2);
});

test("legacy settings fields are rejected without mutating active settings", async t => {
  const { request } = await fixture(t);
  const initial = await settings(await request("/settings", "PUT", { income: 100.29, avatar: "https://example.test/avatar.png" }));
  for (const field of ["baseDailySpending", "maxDailySpending", "base_daily_spending", "max_daily_spending"]) {
    for (const body of [{ [field]: 0 }, { ...initial, income: 200, [field]: 10.01 }]) {
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
  const bodies: unknown[] = [null, [], "bad", { income: -1 }, { income: 1e12 + 1 }, { income: 0.001 }, { income: 1e-7 }, { income: "12" },
    { income: null }, { income: Number.POSITIVE_INFINITY }, { name: "Profile" }, { email: "a@b.test" }, { theme: "light" }, { userId: randomUUID() },
    { avatar: "javascript:alert(1)" }, { avatar: "data:image/png;base64,xxx" }, { avatar: "//example.test/a" }, { avatar: "https://user:pass@example.test/a" },
    { avatar: "https://example.test/" + "a".repeat(2048) }, { avatar: " " }, { categories: {} }, { categories: null },
    { categories: Array.from({ length: 51 }, (_, i) => ({ ...category, id: String(i) })) }, { categories: [category, category] },
  ];
  for (const patch of [{ id: "" }, { id: "a".repeat(101) }, { name: " " }, { name: "a".repeat(101) }, { color: "#fff" },
    { color: "#GGGGGG" }, { icon: "NotAnIcon" }, { icon: 1 }, { extra: true }]) bodies.push({ categories: [{ ...category, ...patch }] });
  for (const body of bodies) assert.equal((await request("/settings", "PUT", body)).status, 400, JSON.stringify(body));
  assert.deepEqual(await settings(await request("/settings")), defaultFinanceSettings());
  const boundaries = await settings(await request("/settings", "PUT", { income: 1e12, avatar: "http://example.test/a" }));
  assert.equal(boundaries.income, 1e12);
  assert.equal(boundaries.avatar, "http://example.test/a");
  for (const income of [0.01, 0.29, 0]) {
    assert.deepEqual(await settings(await request("/settings", "PUT", { income })), { ...boundaries, income });
  }
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
  const categories = Array.from({ length: 50 }, (_, index) => ({
    id: `${index}${"界".repeat(97)}`, name: "界".repeat(100), color: "#123456", icon: "Coffee",
  }));
  assert.deepEqual((await settings(await request("/settings", "PUT", { categories }))).categories, categories);
  const badJson = await fetch(`${url}/settings`, { method: "PUT", headers: { Origin: origin, Authorization: `Bearer ${tokens[0]}`, "Content-Type": "application/json" }, body: "{" });
  assert.equal(badJson.status, 400);
  assert.equal((await request("/settings", "PUT", { avatar: "a".repeat(150000) })).status, 413);
  store.fail = true;
  for (const [path, method, body] of [["/settings", "GET", undefined], ["/settings", "PUT", {}], ["/spendings", "GET", undefined], ["/spendings", "POST", input],
      ["/income-entries", "GET", undefined], ["/income-entries", "POST", incomeInput],
      [`/income-entries/${randomUUID()}`, "PUT", incomeInput], [`/income-entries/${randomUUID()}`, "DELETE", undefined]] as const) {
    const response = await request(path, method, body);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Service temporarily unavailable" });
  }
});

async function createdIncome(response: Response): Promise<IncomeEntry> {
  assert.equal(response.status, 201);
  const body = await response.json() as { incomeEntry: IncomeEntry };
  assert.deepEqual(Object.keys(body), ["incomeEntry"]);
  assert.deepEqual(Object.keys(body.incomeEntry).sort(), ["amount", "description", "id", "month"]);
  assert.match(body.incomeEntry.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(typeof body.incomeEntry.amount, "number");
  return body.incomeEntry;
}

async function incomePage(response: Response): Promise<IncomeEntryPage> {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as IncomeEntryPage;
  assert.deepEqual(Object.keys(body).sort(), ["incomeEntries", "nextCursor"]);
  return body;
}

test("income entry CRUD is additive, unseeded, isolated and independent of recurring settings/categories", async t => {
  const { request, users, store } = await fixture(t);
  assert.deepEqual(await incomePage(await request("/income-entries")), { incomeEntries: [], nextCursor: null });
  assert.equal(store.settings.size, 0, "income reads must not initialize settings");
  const initial = await settings(await request("/settings", "PUT", { income: 2000, categories: [] }));
  const first = await createdIncome(await request(`/income-entries?userId=${users[1].id}`, "POST", { ...incomeInput, description: "  Bonus  " }));
  assert.deepEqual(first, { id: first.id, ...incomeInput });
  const second = await createdIncome(await request("/income-entries", "POST", { ...incomeInput, description: "Freelance" }));
  assert.notEqual(first.id, second.id);
  assert.equal((await incomePage(await request("/income-entries"))).incomeEntries.reduce((sum, row) => sum + row.amount, 0), 200.58);
  assert.deepEqual(await incomePage(await request("/income-entries", "GET", undefined, 1)), { incomeEntries: [], nextCursor: null });
  const path = `/income-entries/${first.id}`;
  assert.equal((await request(path, "PUT", incomeInput, 1)).status, 404);
  assert.equal((await request(path, "DELETE", undefined, 1)).status, 404);
  const changed = { month: "2025-12", amount: 0.29, description: "Updated bonus" };
  const updated = await request(`/income-entries/${first.id.toUpperCase()}`, "PUT", changed);
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { incomeEntry: { id: first.id, ...changed } });
  assert.deepEqual((await incomePage(await request("/income-entries"))).incomeEntries, [{ id: first.id, ...changed }, second].sort((a, b) => a.id < b.id ? -1 : 1));
  for (const id of ["not-a-uuid", randomUUID()]) {
    assert.equal((await request(`/income-entries/${id}`, "PUT", incomeInput)).status, 404);
    assert.equal((await request(`/income-entries/${id}`, "DELETE")).status, 404);
  }
  assert.equal((await request("/income-entries", "PUT", incomeInput)).status, 404);
  assert.equal((await request("/income-entries", "DELETE")).status, 404);
  const deleted = await request(path, "DELETE");
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), "");
  assert.equal((await request(path, "DELETE")).status, 404);
  assert.equal((await request(path, "PUT", incomeInput)).status, 404);
  assert.deepEqual(await incomePage(await request("/income-entries")), { incomeEntries: [second], nextCursor: null });
  assert.deepEqual(await settings(await request("/settings")), initial);
  assert.deepEqual(await (await request("/spendings")).json(), { spendings: [], nextCursor: null });
});

test("income entries require full strict input, actual months, positive cents and trimmed nonblank descriptions", async t => {
  const { request } = await fixture(t);
  const entry = await createdIncome(await request("/income-entries", "POST", incomeInput));
  const bodies: unknown[] = [null, [], {}, "invalid"];
  for (const field of Object.keys(incomeInput)) {
    const body = { ...incomeInput } as Record<string, unknown>;
    delete body[field];
    bodies.push(body);
  }
  for (const field of ["id", "userId", "user_id", "income", "override", "category", "extra"]) bodies.push({ ...incomeInput, [field]: randomUUID() });
  for (const month of ["0000-01", "10000-01", "2024-00", "2024-13", "2024-1", "24-01", "2024-01-01", "2024-02 ", " 2024-02", "2024-+1", "", null, 202402]) bodies.push({ ...incomeInput, month });
  for (const amount of [0, -0, -1, 1e12 + 0.01, 0.001, 1e-7, "1", null, NaN, Infinity, -Infinity]) bodies.push({ ...incomeInput, amount });
  for (const description of ["", "   ", "a".repeat(501), null, 1, "bad\ntext", "bad\ttext", "bad\u0000text", "bad\u007ftext", "bad\u0085text"]) bodies.push({ ...incomeInput, description });
  for (const body of bodies) {
    assert.equal((await request("/income-entries", "POST", body)).status, 400, JSON.stringify(body));
    assert.equal((await request(`/income-entries/${entry.id}`, "PUT", body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(await incomePage(await request("/income-entries")), { incomeEntries: [entry], nextCursor: null });
  for (const month of ["0001-01", "2024-02", "9999-12"]) {
    const body = { month, amount: 1e12, description: "a".repeat(500) };
    const boundary = await createdIncome(await request("/income-entries", "POST", body));
    assert.deepEqual(boundary, { id: boundary.id, ...body });
  }
  const minimum = await createdIncome(await request("/income-entries", "POST", { ...incomeInput, amount: 0.01, description: " x " }));
  assert.equal(minimum.description, "x");
  for (const amount of [NaN, Infinity, -Infinity]) assert.throws(() => incomeEntryInput({ ...incomeInput, amount }), /Invalid amount/);
});

test("income entry UUID pagination is complete, scoped and supports deleted/cross-user cursors", async t => {
  const { request, store, users } = await fixture(t);
  const ids = Array.from({ length: 503 }, () => randomUUID()).sort();
  for (const id of ids) store.incomeRows(users[0].id).set(id, { id, ...incomeInput });
  const otherId = randomUUID();
  store.incomeRows(users[1].id).set(otherId, { id: otherId, ...incomeInput });
  const first = await incomePage(await request("/income-entries"));
  assert.deepEqual(first.incomeEntries.map(row => row.id), ids.slice(0, 500));
  assert.equal(first.nextCursor, ids[499]);
  const second = await incomePage(await request(`/income-entries?limit=500&cursor=${first.nextCursor}`));
  assert.deepEqual(second.incomeEntries.map(row => row.id), ids.slice(500));
  assert.equal(second.nextCursor, null);
  const retrieved: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await incomePage(await request(`/income-entries?limit=37${cursor ? `&cursor=${cursor}` : ""}`));
    retrieved.push(...page.incomeEntries.map(row => row.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(retrieved, ids);
  assert.equal((await request(`/income-entries/${ids[499]}`, "DELETE")).status, 204);
  assert.deepEqual(await incomePage(await request(`/income-entries?cursor=${ids[499].toUpperCase()}`)), second);
  assert.deepEqual((await incomePage(await request(`/income-entries?cursor=${otherId}`))).incomeEntries.map(row => row.id), ids.filter(id => id > otherId && id !== ids[499]).slice(0, 500));
  assert.deepEqual(await incomePage(await request("/income-entries", "GET", undefined, 1)), { incomeEntries: [{ id: otherId, ...incomeInput }], nextCursor: null });
  assert.deepEqual(await incomePage(await request(`/income-entries?cursor=${ids[502]}`)), { incomeEntries: [], nextCursor: null });
  for (const query of ["limit=0", "limit=501", "limit=-1", "limit=1.5", "limit=01", "limit=", "limit=1&limit=2", "limit[x]=2", "cursor=bad", "cursor=", `cursor=${ids[0]}&cursor=${ids[1]}`, "cursor[x]=x"]) {
    assert.equal((await request(`/income-entries?${query}`)).status, 400, query);
  }
});

test("income entry writes use the existing origin guard and CORS", async t => {
  const { request, url, tokens } = await fixture(t);
  for (const method of ["POST", "PUT", "DELETE"]) {
    const path = method === "POST" ? "/income-entries" : `/income-entries/${randomUUID()}`;
    for (const Origin of ["", "https://evil.example"]) {
      assert.equal((await request(path, method, method === "DELETE" ? undefined : incomeInput, 0, { Origin })).status, 403);
    }
    const missingOrigin = await fetch(`${url}${path}`, { method, headers: { Authorization: `Bearer ${tokens[0]}`, "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(incomeInput) });
    assert.equal(missingOrigin.status, 403);
    const preflight = await fetch(`${url}${path}`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": method } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.ok(preflight.headers.get("access-control-allow-methods")!.includes(method));
  }
});
