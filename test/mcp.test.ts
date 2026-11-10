import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { createApplication } from "../src/server/application";
import { hashToken } from "../src/server/auth/crypto";
import type { Account, ApiKeyCreateInput, ApiKeyRecord, AuthStore, TokenHashes, User } from "../src/server/auth/store";
import {
  defaultFinanceSettings,
  type FinanceSettings,
  type Income,
  type IncomeInput,
  type RepeatRule,
  type RepeatRuleInput,
  type SettingsPatch,
  type Spending,
  type SpendingInput,
} from "../src/server/finance/model";
import { formatDateUtc, generateOccurrences, isRuleDueForSync } from "../src/server/finance/recurrence";
import type { FinanceStore } from "../src/server/finance/store";
import { applySettingsPatch, MemoryPlans, paycheckInUse, planSpendingsBetween, resetPaycheck } from "./support/memoryPlans";
import { MemoryLedger } from "./support/memoryLedger";

class MemoryAuthStore implements AuthStore {
  accounts = new Map<string, Account>();
  attempts = new Map<string, number>();
  sessions: Array<TokenHashes & { userId: string; revoked: boolean; expired: boolean; history: Set<string> }> = [];
  apiKeys = new Map<string, ApiKeyRecord & { userId: string; keyHash: string; revokedAt: string | null }>();
  /** Stands in for the ON DELETE CASCADE foreign keys from finance tables to auth_users. */
  onDeleteAccount: (userId: string) => void = () => {};

  async reserveAttempt(key: string) {
    const count = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, count);
    return count <= 10;
  }
  async findAccount(email: string) {
    return this.accounts.get(email);
  }
  async register(name: string, email: string, passwordHash: string, tokens: TokenHashes) {
    if (this.accounts.has(email)) return undefined;
    const account: Account = { id: randomUUID(), name, email, passwordHash, createdAt: new Date().toISOString() };
    this.accounts.set(email, account);
    await this.createSession(account.id, tokens);
    return this.publicUser(account.id);
  }
  async createSession(userId: string, tokens: TokenHashes) {
    this.sessions.push({ ...tokens, userId, revoked: false, expired: false, history: new Set([tokens.refreshHash]) });
  }
  publicUser(userId: string): User {
    const account = [...this.accounts.values()].find(acc => acc.id === userId)!;
    const { passwordHash: _hash, ...user } = account;
    return user;
  }
  async rotate(oldHash: string, tokens: TokenHashes) {
    const session = this.sessions.find(s => s.history.has(oldHash));
    if (!session || session.revoked || session.expired || session.refreshHash !== oldHash) return undefined;
    Object.assign(session, tokens);
    session.history.add(tokens.refreshHash);
    return this.publicUser(session.userId);
  }
  async revoke(refreshHash?: string, accessHash?: string) {
    for (const session of this.sessions) {
      if ((refreshHash && session.history.has(refreshHash)) || session.accessHash === accessHash) session.revoked = true;
    }
  }
  async authenticate(hash: string) {
    const session = this.sessions.find(s => s.accessHash === hash && !s.revoked && !s.expired);
    return session ? this.publicUser(session.userId) : undefined;
  }
  async deleteAccount(userId: string) {
    const account = [...this.accounts.values()].find(acc => acc.id === userId);
    if (!account) return false;
    this.accounts.delete(account.email);
    this.sessions = this.sessions.filter(s => s.userId !== userId);
    for (const [id, key] of this.apiKeys) if (key.userId === userId) this.apiKeys.delete(id);
    this.onDeleteAccount(userId);
    return true;
  }
  async listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
    return [...this.apiKeys.values()]
      .filter(k => k.userId === userId && !k.revokedAt)
      .map(({ userId: _u, keyHash: _h, revokedAt: _r, ...rec }) => rec);
  }
  async createApiKey(userId: string, input: ApiKeyCreateInput): Promise<ApiKeyRecord> {
    const record: ApiKeyRecord & { userId: string; keyHash: string; revokedAt: string | null } = {
      id: randomUUID(),
      userId,
      name: input.name,
      keyPrefix: input.keyPrefix,
      keyHash: input.keyHash,
      scope: input.scope ?? "write",
      lastUsedAt: null,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.apiKeys.set(record.id, record);
    const { userId: _u, keyHash: _h, revokedAt: _r, ...publicRec } = record;
    return publicRec;
  }
  async revokeApiKey(userId: string, keyId: string): Promise<boolean> {
    const key = this.apiKeys.get(keyId);
    if (!key || key.userId !== userId || key.revokedAt) return false;
    key.revokedAt = new Date().toISOString();
    return true;
  }
  async authenticateApiKey(keyHash: string): Promise<{ user: User; scope: "read" | "write" } | undefined> {
    const key = [...this.apiKeys.values()].find(k => k.keyHash === keyHash && !k.revokedAt);
    if (!key) return undefined;
    if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return undefined;
    key.lastUsedAt = new Date().toISOString();
    return { user: this.publicUser(key.userId), scope: key.scope };
  }
}

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

  rows(userId: string) {
    if (!this.spendings.has(userId)) this.spendings.set(userId, new Map());
    return this.spendings.get(userId)!;
  }
  incomeRows(userId: string) {
    if (!this.incomes.has(userId)) this.incomes.set(userId, new Map());
    return this.incomes.get(userId)!;
  }
  repeatRuleRows(userId: string) {
    if (!this.repeatRules.has(userId)) this.repeatRules.set(userId, new Map());
    return this.repeatRules.get(userId)!;
  }
  async getSettings(userId: string) {
    if (!this.settings.has(userId)) this.settings.set(userId, defaultFinanceSettings());
    return structuredClone(this.settings.get(userId)!);
  }
  async updateSettings(userId: string, patch: SettingsPatch) {
    const next = applySettingsPatch(await this.getSettings(userId), patch, this.incomeRows(userId));
    if (next === "invalid-budget-period") return next;
    this.settings.set(userId, next);
    return structuredClone(next);
  }
  async listPlanSpendings(userId: string, from: string, to: string) {
    return planSpendingsBetween(this.rows(userId).values(), from, to);
  }
  async listSpendings(userId: string, limit: number, cursor?: string, startDate?: string, endDate?: string) {
    await this.materializePlans(userId);
    const rows = [...this.rows(userId).values()]
      .filter(r => (!cursor || r.id > cursor) && (!startDate || r.date >= startDate) && (!endDate || r.date <= endDate))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const page = rows.slice(0, limit);
    return { spendings: structuredClone(page), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }
  async createSpending(userId: string, input: SpendingInput) {
    if (!(await this.getSettings(userId)).categories.some(c => c.id === input.category)) return undefined;
    const spending: Spending = { id: randomUUID(), ...input };
    if (!input.repeatRuleId) delete spending.repeatRuleId;
    this.rows(userId).set(spending.id, spending);
    return structuredClone(spending);
  }
  async updateSpending(userId: string, id: string, input: SpendingInput) {
    if (!this.rows(userId).has(id)) return "not-found" as const;
    if (!(await this.getSettings(userId)).categories.some(c => c.id === input.category)) return "invalid-category" as const;
    const spending: Spending = { id, ...input };
    if (!input.repeatRuleId) delete spending.repeatRuleId;
    this.rows(userId).set(id, spending);
    return structuredClone(spending);
  }
  async deleteSpending(userId: string, id: string) {
    return this.rows(userId).delete(id);
  }
  async listIncomes(userId: string, limit: number, cursor?: string) {
    await this.ledger.materializeIncomes(userId);
    const rows = [...this.incomeRows(userId).values()]
      .filter(r => !cursor || r.id > cursor)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const page = rows.slice(0, limit);
    return { incomes: structuredClone(page), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }
  async createIncome(userId: string, input: IncomeInput) {
    const income: Income = { id: randomUUID(), ...input };
    this.incomeRows(userId).set(income.id, income);
    return structuredClone(income);
  }
  async updateIncome(userId: string, id: string, input: IncomeInput) {
    if (!this.incomeRows(userId).has(id)) return undefined;
    if (paycheckInUse(this.settings.get(userId), id, input)) return "paycheck-in-use" as const;
    const before = this.incomeRows(userId).get(id)!;
    const income: Income = { id, ...input };
    this.incomeRows(userId).set(id, income);
    this.ledger.incomeUpdated(userId, before, income);
    return structuredClone(income);
  }
  async deleteIncome(userId: string, id: string) {
    resetPaycheck(this.settings.get(userId), id);
    const before = this.incomeRows(userId).get(id);
    if (before) this.ledger.incomeDeleted(userId, before);
    return this.incomeRows(userId).delete(id);
  }
  async listRepeatRules(userId: string) {
    return [...this.repeatRuleRows(userId).values()];
  }
  async createRepeatRule(userId: string, input: RepeatRuleInput) {
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
    });
    const rule: RepeatRule = {
      id: ruleId,
      userId,
      ...input,
      interval: input.interval ?? 1,
      daysOfWeek: input.daysOfWeek ?? [],
      occurrencesCreated: batch.newOccurrencesCreated,
      lastGeneratedDate: batch.newLastGeneratedDate,
      createdAt: new Date().toISOString(),
    };
    this.repeatRuleRows(userId).set(ruleId, rule);
    const spendings: Spending[] = [];
    for (const date of batch.dates) {
      const s = await this.createSpending(userId, {
        amount: input.amount,
        description: input.description,
        category: input.category,
        date,
        time: input.time,
        repeatRuleId: ruleId,
      });
      if (s) spendings.push(s);
    }
    return { repeatRule: structuredClone(rule), spendings };
  }
  async deleteRepeatRule(userId: string, id: string, deleteFuture = true) {
    if (!this.repeatRuleRows(userId).has(id)) return false;
    const todayStr = formatDateUtc(new Date());
    if (deleteFuture) {
      for (const [sId, s] of this.rows(userId).entries()) {
        if (s.repeatRuleId === id && s.date >= todayStr) {
          this.rows(userId).delete(sId);
        }
      }
    }
    this.repeatRuleRows(userId).delete(id);
    return true;
  }
  async syncRepeatSpendings(userId: string, asOfDate?: string) {
    const todayStr = asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate) ? asOfDate : formatDateUtc(new Date());
    let created = 0;
    for (const rule of this.repeatRuleRows(userId).values()) {
      const state = {
        startDate: rule.startDate,
        frequency: rule.frequency,
        interval: rule.interval ?? 1,
        daysOfWeek: rule.daysOfWeek,
        endType: rule.endType,
        totalOccurrences: rule.totalOccurrences,
        endDate: rule.endDate,
        occurrencesCreated: rule.occurrencesCreated,
        lastGeneratedDate: rule.lastGeneratedDate,
      };
      if (!isRuleDueForSync(state, todayStr)) continue;
      const batch = generateOccurrences(state);
      rule.occurrencesCreated = batch.newOccurrencesCreated;
      rule.lastGeneratedDate = batch.newLastGeneratedDate;
      for (const date of batch.dates) {
        await this.createSpending(userId, {
          amount: rule.amount,
          description: rule.description,
          category: rule.category,
          date,
          time: rule.time,
          repeatRuleId: rule.id,
        });
        created++;
      }
    }
    return created;
  }
}

const origin = "http://localhost:5173";

async function createTestFixture(t: TestContext) {
  const authStore = new MemoryAuthStore();
  const financeStore = new MemoryFinanceStore();
  authStore.onDeleteAccount = userId => {
    financeStore.settings.delete(userId);
    financeStore.spendings.delete(userId);
    financeStore.incomes.delete(userId);
    financeStore.repeatRules.delete(userId);
  };
  const app = createApplication({ databaseUrl: "unused", appOrigin: origin, production: false }, authStore, financeStore);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
    server.closeAllConnections();
  }));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      name: "Agent Tester",
      email: "agent@example.com",
      password: "correct horse battery staple",
    }),
  });
  assert.equal(regRes.status, 201);
  const { user, accessToken } = (await regRes.json()) as { user: User; accessToken: string };

  async function mcpCall(body: unknown, tokenOrKey: string, extraHeaders: Record<string, string> = {}) {
    return fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenOrKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
  }

  return { baseUrl, authStore, financeStore, user, accessToken, mcpCall };
}

test("Personal Access Tokens (PAT) creation, listing, authentication, expiry, and revocation", async t => {
  const { baseUrl, authStore, accessToken, mcpCall } = await createTestFixture(t);

  // Create PAT
  const createRes = await fetch(`${baseUrl}/api/v1/auth/api-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name: "Claude Desktop", expiresInDays: 30 }),
  });
  assert.equal(createRes.status, 201);
  const { apiKey, secret } = (await createRes.json()) as { apiKey: ApiKeyRecord; secret: string };
  assert.match(secret, /^mf_pat_[A-Za-z0-9_-]{43}$/);
  assert.equal(apiKey.name, "Claude Desktop");
  assert.equal(apiKey.keyPrefix, `${secret.slice(0, 11)}…${secret.slice(-4)}`);
  assert.equal(apiKey.scope, "write");
  assert.ok(apiKey.expiresAt);

  // Create a read-only PAT and verify it blocks write tools while allowing read tools
  const readKeyRes = await fetch(`${baseUrl}/api/v1/auth/api-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name: "Read-only Agent", scope: "read" }),
  });
  assert.equal(readKeyRes.status, 201);
  const { secret: readSecret } = (await readKeyRes.json()) as { secret: string };
  const readAllowed = await mcpCall(
    { jsonrpc: "2.0", id: "r1", method: "tools/call", params: { name: "get_profile_and_settings", arguments: {} } },
    readSecret,
  );
  assert.equal(((await readAllowed.json()) as { result: { isError: boolean } }).result.isError, false);
  const writeBlocked = await mcpCall(
    {
      jsonrpc: "2.0",
      id: "w1",
      method: "tools/call",
      params: { name: "create_spending", arguments: { amount: 10000, description: "Blocked", category: "Food" } },
    },
    readSecret,
  );
  const writeBlockedBody = (await writeBlocked.json()) as { result: { isError: boolean; structuredContent: { error: string } } };
  assert.equal(writeBlockedBody.result.isError, true);
  assert.match(writeBlockedBody.result.structuredContent.error, /requires a token with 'write' scope/);

  // List PATs (never returns secret or hash)
  const listRes = await fetch(`${baseUrl}/api/v1/auth/api-keys`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert.equal(listRes.status, 200);
  const listed = (await listRes.json()) as { apiKeys: Array<Record<string, unknown>> };
  assert.equal(listed.apiKeys.length, 2);
  assert.equal(listed.apiKeys[0].id, apiKey.id);
  assert.equal(listed.apiKeys[0].secret, undefined);
  assert.equal(listed.apiKeys[0].keyHash, undefined);

  // Authenticate MCP via Bearer PAT (without browser Origin header!)
  const pingRes = await mcpCall({ jsonrpc: "2.0", id: 1, method: "ping" }, secret);
  assert.equal(pingRes.status, 200);
  assert.deepEqual(await pingRes.json(), { jsonrpc: "2.0", id: 1, result: {} });

  // Authenticate MCP via X-API-Key header
  const xApiKeyRes = await fetch(`${baseUrl}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": secret },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
  });
  assert.equal(xApiKeyRes.status, 200);
  assert.deepEqual(await xApiKeyRes.json(), { jsonrpc: "2.0", id: 2, result: {} });

  // Expired PAT is rejected
  const storedKey = authStore.apiKeys.get(apiKey.id)!;
  storedKey.expiresAt = new Date(Date.now() - 10_000).toISOString();
  const expiredRes = await mcpCall({ jsonrpc: "2.0", id: 3, method: "ping" }, secret);
  assert.equal(expiredRes.status, 401);
  assert.match(expiredRes.headers.get("www-authenticate") ?? "", /Bearer/);

  // Restore expiry, then revoke via DELETE /api/v1/auth/api-keys/:id
  storedKey.expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal((await mcpCall({ jsonrpc: "2.0", id: 4, method: "ping" }, secret)).status, 200);

  const delRes = await fetch(`${baseUrl}/api/v1/auth/api-keys/${apiKey.id}`, {
    method: "DELETE",
    headers: { Origin: origin, Authorization: `Bearer ${accessToken}` },
  });
  assert.equal(delRes.status, 204);

  // Revoked PAT is rejected
  const revokedRes = await mcpCall({ jsonrpc: "2.0", id: 5, method: "ping" }, secret);
  assert.equal(revokedRes.status, 401);
});

test("MCP Streamable HTTP protocol: initialize, notifications, batch, SSE, discovery, and error handling", async t => {
  const { baseUrl, accessToken, mcpCall } = await createTestFixture(t);

  // OPTIONS preflight from external client
  const optRes = await fetch(`${baseUrl}/api/mcp`, {
    method: "OPTIONS",
    headers: { Origin: "http://inspector.local" },
  });
  assert.equal(optRes.status, 204);
  assert.match(optRes.headers.get("access-control-allow-headers") ?? "", /Mcp-Session-Id/);

  // GET discovery
  const getRes = await fetch(`${baseUrl}/api/mcp`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert.equal(getRes.status, 200);
  const discovery = (await getRes.json()) as { name: string; transport: string; capabilities: { tools: number } };
  assert.equal(discovery.name, "my-finance-mcp");
  assert.equal(discovery.transport, "streamable-http");
  assert.ok(discovery.capabilities.tools >= 18);

  // GET SSE stream when Accept: text/event-stream
  const sseGet = await fetch(`${baseUrl}/api/mcp`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "text/event-stream" },
  });
  assert.equal(sseGet.status, 200);
  assert.match(sseGet.headers.get("content-type") ?? "", /text\/event-stream/);

  // Initialize handshake
  const initRes = await mcpCall(
    {
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-agent", version: "1.0.0" },
      },
    },
    accessToken,
  );
  assert.equal(initRes.status, 200);
  const sessionId = initRes.headers.get("mcp-session-id");
  assert.ok(sessionId);
  const initBody = (await initRes.json()) as {
    result: { protocolVersion: string; serverInfo: { name: string }; instructions: string };
  };
  assert.equal(initBody.result.protocolVersion, "2025-03-26");
  assert.equal(initBody.result.serverInfo.name, "my-finance-mcp");
  assert.ok(initBody.result.instructions.includes("MyFinance"));

  // Notification returns 202 Accepted with empty body
  const notifRes = await mcpCall(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    accessToken,
    { "Mcp-Session-Id": sessionId! },
  );
  assert.equal(notifRes.status, 202);
  assert.equal(await notifRes.text(), "");

  // Batch JSON-RPC request
  const batchRes = await mcpCall(
    [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 10, method: "tools/list" },
      { jsonrpc: "2.0", id: 11, method: "resources/list" },
      { jsonrpc: "2.0", id: 12, method: "prompts/list" },
    ],
    accessToken,
  );
  assert.equal(batchRes.status, 200);
  const batchBody = (await batchRes.json()) as Array<{ id: number; result: Record<string, unknown> }>;
  assert.equal(batchBody.length, 3);
  assert.ok(Array.isArray(batchBody[0].result.tools));
  assert.ok(Array.isArray(batchBody[1].result.resources));
  assert.ok(Array.isArray(batchBody[2].result.prompts));

  // Unknown method returns -32601
  const unknownRes = await mcpCall({ jsonrpc: "2.0", id: 99, method: "unknown/method" }, accessToken);
  assert.equal(unknownRes.status, 200);
  const unknownBody = (await unknownRes.json()) as { error: { code: number } };
  assert.equal(unknownBody.error.code, -32601);

  // Malformed JSON returns -32700 Parse Error
  const badJsonRes = await fetch(`${baseUrl}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: "{invalid json",
  });
  assert.equal(badJsonRes.status, 400);
  const badJsonBody = (await badJsonRes.json()) as { error: { code: number } };
  assert.equal(badJsonBody.error.code, -32700);

  // DELETE /api/mcp terminates session with 204
  const delSession = await fetch(`${baseUrl}/api/mcp`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}`, "Mcp-Session-Id": sessionId! },
  });
  assert.equal(delSession.status, 204);
});

test("MCP Tools, Resources, and Prompts end-to-end finance workflows", async t => {
  const { accessToken, mcpCall } = await createTestFixture(t);

  async function callTool(name: string, args: Record<string, unknown> = {}) {
    const res = await mcpCall(
      { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } },
      accessToken,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      result: { structuredContent: Record<string, unknown>; isError: boolean };
    };
    return body.result;
  }

  // 1. Get profile and settings
  const profile = await callTool("get_profile_and_settings");
  assert.equal(profile.isError, false);
  assert.equal((profile.structuredContent.user as User).email, "agent@example.com");

  // 2. Upsert a new category 'Coffee'
  const upserted = await callTool("upsert_category", {
    id: "Coffee",
    name: "Coffee & Tea",
    color: "#10b981",
    icon: "Coffee",
  });
  assert.equal(upserted.isError, false);
  assert.equal(upserted.structuredContent.action, "created");

  // 3. Create single spending and batch spendings
  const createdSpending = await callTool("create_spending", {
    amount: 45000,
    description: "Iced Latte",
    category: "Coffee",
    date: "2026-10-10",
    time: "08:30",
  });
  assert.equal(createdSpending.isError, false);
  const spendingId = (createdSpending.structuredContent.spending as Spending).id;

  const batchResult = await callTool("batch_create_spendings", {
    spendings: [
      { amount: 120000, description: "Lunch pho", category: "Food", date: "2026-10-11", time: "12:15" },
      { amount: 85000, description: "Grab ride", category: "Transport", date: "2026-10-12", time: "18:00" },
    ],
  });
  assert.equal(batchResult.isError, false);
  assert.equal(batchResult.structuredContent.createdCount, 2);

  // Invalid category returns isError: true with helpful valid categories list
  const invalidCat = await callTool("create_spending", {
    amount: 50000,
    description: "Test",
    category: "NonExistentCategory",
    date: "2026-10-12",
    time: "10:00",
  });
  assert.equal(invalidCat.isError, true);
  assert.match(String(invalidCat.structuredContent.error), /Valid categories:/);

  // 4. List & filter spendings, update and delete spending
  const filteredSpendings = await callTool("list_spendings", {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    search: "latte",
  });
  assert.equal(filteredSpendings.isError, false);
  assert.equal(filteredSpendings.structuredContent.totalMatched, 1);

  const updatedSpending = await callTool("update_spending", {
    id: spendingId,
    amount: 50000,
    description: "Large Iced Latte",
    category: "Coffee",
    date: "2026-10-10",
    time: "08:35",
  });
  assert.equal(updatedSpending.isError, false);
  assert.equal((updatedSpending.structuredContent.spending as Spending).amount, 50000);

  // 5. Create and list income
  const createdIncome = await callTool("create_income", {
    source: "Salary",
    name: "Tech Corp",
    amount: 30000000,
    frequency: "monthly",
    startDate: "2026-10-05",
  });
  assert.equal(createdIncome.isError, false);

  const incomesList = await callTool("list_incomes", { month: "2026-10" });
  assert.equal(incomesList.isError, false);
  assert.equal(incomesList.structuredContent.monthlyTotal, 30000000);

  // 6. A monthly commitment (plan) plus this month's real payment
  const planCreated = await callTool("create_plan", {
    amount: 200000,
    description: "Gym membership",
    category: "Other",
    startDate: "2026-10-01",
    time: "09:00",
    frequency: "monthly",
    sure: true,
  });
  assert.equal(planCreated.isError, false);
  const gymPaid = await callTool("create_spending", { amount: 200000, description: "Gym membership", category: "Other", date: "2026-10-01", time: "09:00" });
  assert.equal(gymPaid.isError, false);

  // 7. Analytics & summary tools
  const rangeSummary = await callTool("get_date_range_summary", {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  });
  assert.equal(rangeSummary.isError, false);
  assert.equal(rangeSummary.structuredContent.totalIncome, 30000000);
  assert.ok(Number(rangeSummary.structuredContent.totalSpending) >= 255000);

  const monthlyAnalytics = await callTool("get_monthly_analytics", { month: "2026-10" });
  assert.equal(monthlyAnalytics.isError, false);
  assert.equal(monthlyAnalytics.structuredContent.month, "2026-10");

  const cycleSummary = await callTool("get_salary_cycle_summary", {
    cycleMonth: "2026-10",
    salaryDay: 5,
  });
  assert.equal(cycleSummary.isError, false);
  assert.equal(cycleSummary.structuredContent.cycleMonth, "2026-10");
  // The override parameters are accepted and ignored: the report follows the saved budget period (calendar by default).
  assert.deepEqual((cycleSummary.structuredContent.dates as { startDate: string; endDate: string }).startDate, "2026-10-01");
  assert.deepEqual((cycleSummary.structuredContent.config as { ignoredParameters: string[] }).ignoredParameters, ["salaryDay"]);

  // 8. Read MCP Resources (static and templated)
  for (const uri of [
    "finance://profile",
    "finance://overview/current-month",
    "finance://incomes",
    "finance://repeat-rules",
    "finance://analytics/2026-10",
    "finance://salary-cycle/2026-10",
    "finance://spendings/2026-10-01/2026-10-31",
  ]) {
    const res = await mcpCall(
      { jsonrpc: "2.0", id: uri, method: "resources/read", params: { uri } },
      accessToken,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { result: { contents: Array<{ uri: string; text: string }> } };
    assert.equal(body.result.contents[0].uri, uri);
    assert.ok(JSON.parse(body.result.contents[0].text));
  }

  // 9. Get MCP Prompts
  for (const promptCall of [
    { name: "monthly_budget_review", arguments: { month: "2026-10" } },
    { name: "salary_cycle_checkup", arguments: { cycleMonth: "2026-10", salaryDay: 5 } },
    { name: "categorize_and_log_expenses", arguments: { rawText: "Coffee 45k, Taxi 110k" } },
    { name: "cashflow_forecast", arguments: { month: "2026-10" } },
  ]) {
    const res = await mcpCall(
      { jsonrpc: "2.0", id: promptCall.name, method: "prompts/get", params: promptCall },
      accessToken,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { result: { messages: Array<{ role: string; content: { text: string } }> } };
    assert.equal(body.result.messages.length, 1);
    assert.ok(body.result.messages[0].content.text.length > 20);
  }
});

test("account deletion requires the password and removes API keys and finance data", async t => {
  const { baseUrl, financeStore, user, accessToken, mcpCall } = await createTestFixture(t);
  const createRes = await fetch(`${baseUrl}/api/v1/auth/api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name: "Agent" }),
  });
  const { secret } = (await createRes.json()) as { secret: string };
  assert.ok(await financeStore.createSpending(user.id, { amount: 1000, description: "Coffee", category: "Food", date: "2026-11-03", time: "08:00" }));
  await financeStore.createIncome(user.id, { source: "Salary", name: "", amount: 100, frequency: "monthly", startDate: "2026-11-01", endDate: null });
  const profile = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_profile_and_settings", arguments: {} } };
  const deleteAccount = (password: unknown) => fetch(`${baseUrl}/api/v1/auth/account`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Origin: origin, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ password }),
  });

  assert.equal((await deleteAccount("wrong password, long enough")).status, 401);
  assert.equal((await mcpCall(profile, secret)).status, 200);
  assert.equal(financeStore.spendings.get(user.id)?.size, 1);

  assert.equal((await deleteAccount("correct horse battery staple")).status, 204);
  assert.equal((await mcpCall(profile, secret)).status, 401, "API keys no longer authenticate");
  for (const table of [financeStore.settings, financeStore.spendings, financeStore.incomes, financeStore.repeatRules]) {
    assert.equal(table.has(user.id), false);
  }
});

test("MCP plan tools create, forecast, adjust single days, split and delete plans", async t => {
  const { accessToken, mcpCall, financeStore } = await createTestFixture(t);
  // 05:00 UTC = 12:00 in Asia/Ho_Chi_Minh, Wednesday 2026-11-04.
  financeStore.planStore.now = () => new Date("2026-11-04T05:00:00Z");
  async function callTool(name: string, args: Record<string, unknown> = {}) {
    const res = await mcpCall({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }, accessToken);
    assert.equal(res.status, 200);
    return ((await res.json()) as { result: { structuredContent: Record<string, any>; isError: boolean } }).result;
  }

  const created = await callTool("create_plan", { amount: 35000, description: "Lunch", category: "Food", time: "12:30", startDate: "2026-11-02", frequency: "weekdays" });
  assert.equal(created.isError, false);
  const plan = created.structuredContent.plan;
  assert.equal(plan.schedule, "Every weekday");
  assert.equal((await callTool("create_plan", { amount: 1, category: "Nope", startDate: "2026-11-02", frequency: "daily" })).isError, true);

  const skipped = await callTool("update_plan_occurrence", { id: plan.id, date: "2026-11-05", action: "skip" });
  assert.equal(skipped.isError, false);
  await callTool("update_plan_occurrence", { id: plan.id, date: "2026-11-06", action: "override", amount: 50000 });
  assert.equal((await callTool("update_plan_occurrence", { id: plan.id, date: "2026-11-07", action: "skip" })).isError, true);

  // Wed (12:30 still ahead), Thu skipped, Fri 50k, Mon–Fri next week.
  const forecast = await callTool("get_spending_forecast", { startDate: "2026-11-01", endDate: "2026-11-13" });
  assert.equal(forecast.isError, false);
  assert.equal(forecast.structuredContent.spent, 0);
  assert.equal(forecast.structuredContent.planned, 35000 + 50000 + 5 * 35000);
  assert.equal(forecast.structuredContent.byCategory.Food.planned, 260000);

  const listed = await callTool("list_plans");
  assert.equal(listed.structuredContent.today, "2026-11-04");
  assert.equal(listed.structuredContent.plans[0].nextOccurrences[0].date, "2026-11-04");
  assert.equal(listed.structuredContent.plans[0].nextOccurrences[1].date, "2026-11-06");

  const updated = await callTool("update_plan", { id: plan.id, amount: 38000 });
  assert.equal(updated.structuredContent.plan.amount, 38000);
  assert.equal(updated.structuredContent.plan.description, "Lunch");
  const split = await callTool("update_plan", { id: plan.id, amount: 40000, effectiveFrom: "2026-11-16" });
  assert.equal(split.structuredContent.ended.endDate, "2026-11-15");
  assert.equal(split.structuredContent.created.amount, 40000);

  const deleted = await callTool("delete_plan", { id: plan.id });
  assert.equal(deleted.structuredContent.deleted, true);
  assert.equal((await callTool("delete_plan", { id: plan.id })).isError, true);
});

test("MCP plan tools record commitments and mark an occurrence done; repeat tools are gone", async t => {
  const { accessToken, mcpCall, financeStore } = await createTestFixture(t);
  financeStore.planStore.now = () => new Date("2026-11-04T05:00:00Z");
  async function call(method: string, params: Record<string, unknown> = {}) {
    const res = await mcpCall({ jsonrpc: "2.0", id: randomUUID(), method, params }, accessToken);
    return ((await res.json()) as { result: any }).result;
  }
  const names = (await call("tools/list")).tools.map((tool: { name: string }) => tool.name);
  assert.equal(names.some((name: string) => name.includes("repeat_rule")), false);
  const rent = (await call("tools/call", { name: "create_plan", arguments: { amount: 4000000, description: "Rent", category: "Bills", startDate: "2026-11-05", frequency: "monthly", sure: true } })).structuredContent.plan;
  assert.equal(rent.sure, true);
  const done = await call("tools/call", { name: "update_plan_occurrence", arguments: { id: rent.id, date: "2026-11-05", action: "done" } });
  assert.equal(done.isError, false);
  assert.equal(done.structuredContent.spending.planDate, "2026-11-05");
  const again = await call("tools/call", { name: "update_plan_occurrence", arguments: { id: rent.id, date: "2026-11-05", action: "done" } });
  assert.equal(again.isError, true);
  const flipped = await call("tools/call", { name: "update_plan", arguments: { id: rent.id, sure: false } });
  assert.equal(flipped.structuredContent.plan.sure, false);
});

test("MCP income tools carry pay schedule fields and update_income keeps them", async t => {
  const { accessToken, mcpCall } = await createTestFixture(t);
  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await mcpCall({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }, accessToken);
    return ((await res.json()) as { result: any }).result;
  }
  const tools = (await mcpCall({ jsonrpc: "2.0", id: 1, method: "tools/list" }, accessToken).then(res => res.json()) as { result: { tools: { name: string; annotations: { readOnlyHint?: boolean }; inputSchema: { properties: Record<string, unknown> } }[] } }).result.tools;
  for (const name of ["create_income", "update_income"]) {
    const properties = Object.keys(tools.find(tool => tool.name === name)!.inputSchema.properties);
    for (const field of ["interval", "semimonthlyDays", "weekendShift"]) assert.ok(properties.includes(field), `${name} ${field}`);
  }
  for (const name of ["get_plan_period_summary", "get_budget_period"]) assert.equal(tools.find(tool => tool.name === name)?.annotations.readOnlyHint, true, name);

  const created = await call("create_income", { source: "Salary", amount: 1000, frequency: "semimonthly", startDate: "2026-01-01", semimonthlyDays: [15, 31], weekendShift: true });
  assert.equal(created.isError, false);
  const income = created.structuredContent.income as Income;
  assert.deepEqual([income.semimonthlyDays, income.weekendShift], [[15, 31], true]);
  // Updating only the amount through the tool must not reset the options when they are sent again.
  const updated = await call("update_income", { id: income.id, source: "Salary", amount: 1200, frequency: "semimonthly", startDate: "2026-01-01", semimonthlyDays: [15, 31], weekendShift: true });
  assert.equal(updated.isError, false);
  assert.deepEqual([(updated.structuredContent.income as Income).amount, (updated.structuredContent.income as Income).semimonthlyDays, (updated.structuredContent.income as Income).weekendShift], [1200, [15, 31], true]);
  const biweekly = await call("create_income", { source: "Shop", amount: 10, frequency: "weekly", startDate: "2026-01-02", interval: 2 });
  assert.equal((biweekly.structuredContent.income as Income).interval, 2);
  // A plain income has none of the new keys, and bad combinations are rejected.
  const plain = await call("create_income", { source: "Gift", amount: 5, frequency: "monthly", startDate: "2026-01-02", interval: null, semimonthlyDays: null, weekendShift: null });
  assert.equal(plain.isError, false);
  assert.deepEqual(Object.keys(plain.structuredContent.income as Income).filter(key => ["interval", "semimonthlyDays", "weekendShift"].includes(key)), []);
  assert.equal((await call("create_income", { source: "X", amount: 5, frequency: "monthly", startDate: "2026-01-02", interval: 2 })).isError, true);
  assert.equal((await call("create_income", { source: "X", amount: 5, frequency: "semimonthly", startDate: "2026-01-02" })).isError, true);
});

test("MCP budget period tool, resource and plan period summary; list_plans keys are unchanged", async t => {
  const { accessToken, mcpCall, financeStore } = await createTestFixture(t);
  financeStore.planStore.now = () => new Date("2026-11-04T05:00:00Z");
  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await mcpCall({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }, accessToken);
    return ((await res.json()) as { result: any }).result;
  }
  assert.equal((await call("update_settings", { timezone: "UTC" })).isError, false);
  const defaults = await call("get_budget_period");
  assert.deepEqual(defaults.structuredContent.budgetPeriod, { mode: "calendar", startDay: 1, paycheckIncomeId: null });
  assert.equal(defaults.structuredContent.currentPeriod.mode, "calendar");

  const pay = (await call("create_income", { source: "Salary", amount: 1000, frequency: "monthly", startDate: "2026-01-25" })).structuredContent.income as Income;
  const [user] = [...financeStore.settings.keys()];
  const saved = await financeStore.updateSettings(user, { budgetPeriod: { mode: "paycheck", paycheckIncomeId: pay.id } });
  assert.notEqual(saved, "invalid-budget-period");
  assert.equal((await call("create_plan", { amount: 400, description: "Rent", category: "Bills", startDate: "2026-11-01", time: "08:00", frequency: "monthly", sure: true })).isError, false);

  const summary = (await call("get_plan_period_summary", { date: "2026-12-10" })).structuredContent.summary;
  assert.deepEqual(summary.period, { start: "2026-11-25", end: "2026-12-24", nextStart: "2026-12-25", mode: "paycheck" });
  assert.deepEqual([summary.income, summary.spent, summary.committed, summary.tentative, summary.left], [1000, 0, 400, 0, 600]);
  assert.equal((await call("get_plan_period_summary", { date: "2026-13-40" })).isError, true);
  assert.equal((await call("get_plan_period_summary")).isError, false);

  const current = await call("get_budget_period");
  assert.equal(current.structuredContent.budgetPeriod.paycheckIncomeId, pay.id);
  assert.equal(current.structuredContent.currentPeriod.mode, "paycheck");

  const listRes = await mcpCall({ jsonrpc: "2.0", id: 2, method: "resources/list" }, accessToken);
  const resources = ((await listRes.json()) as { result: { resources: { uri: string }[] } }).result.resources;
  assert.ok(resources.some(resource => resource.uri === "finance://budget-period"));
  const readRes = await mcpCall({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "finance://budget-period" } }, accessToken);
  const content = JSON.parse(((await readRes.json()) as { result: { contents: { text: string }[] } }).result.contents[0].text);
  assert.equal(content.budgetPeriod.mode, "paycheck");
  assert.deepEqual(Object.keys(content).sort(), ["budgetPeriod", "currentPeriod", "showBy", "summary", "today"]);

  const plans = await call("list_plans");
  for (const key of ["timezone", "today", "count", "plannedRestOfMonth", "plannedNextMonth", "plans"]) assert.ok(key in plans.structuredContent, key);
});

test("MCP pay cycle report follows the saved budget period and ignores the old override parameters", async t => {
  const { accessToken, mcpCall, financeStore } = await createTestFixture(t);
  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await mcpCall({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }, accessToken);
    return ((await res.json()) as { result: any }).result;
  }
  assert.equal((await call("update_settings", { timezone: "UTC" })).isError, false);
  const [owner] = [...financeStore.settings.keys()];
  assert.ok(owner, "the settings call created the user row");
  for (const [date, amount] of [["2026-09-24", 1], ["2026-09-25", 10], ["2026-10-24", 100], ["2026-10-25", 1000]] as const) {
    assert.equal((await call("create_spending", { amount, description: date, category: "Food", date, time: "08:00" })).isError, false);
  }
  assert.equal((await call("create_income", { source: "Salary", amount: 5000, frequency: "monthly", startDate: "2026-01-25" })).isError, false);

  const calendarReport = (await call("get_salary_cycle_summary", { cycleMonth: "2026-10" })).structuredContent;
  assert.deepEqual([calendarReport.dates.startDate, calendarReport.dates.endDate], ["2026-10-01", "2026-10-31"]);
  assert.deepEqual(calendarReport.config.ignoredParameters, [], "no options means nothing ignored");
  assert.equal(calendarReport.spending.total, 1100, "calendar October holds the 24th and the 25th");

  const saved = await financeStore.updateSettings(owner, { budgetPeriod: { mode: "monthly_from_day", startDay: 25 } });
  assert.notEqual(saved, "invalid-budget-period");
  const report = (await call("get_salary_cycle_summary", { cycleMonth: "2026-10", salaryDay: 5, shiftWeekendToMonday: false, delayDays: 3 })).structuredContent;
  assert.equal(report.cycleMonth, "2026-10");
  assert.deepEqual([report.dates.startDate, report.dates.endDate, report.dates.nextPayday], ["2026-09-25", "2026-10-24", "2026-10-25"], "the period that contains 2026-10-01");
  assert.deepEqual(report.config.ignoredParameters, ["salaryDay", "shiftWeekendToMonday", "delayDays"]);
  assert.deepEqual([report.config.mode, report.config.startDay, report.config.paycheckIncomeId], ["monthly_from_day", 25, null]);
  assert.equal(report.spending.total, 110, "the 24th of September and the 25th of October are outside");
  assert.equal(report.income.total, 5000, "one payday in the period");
  assert.equal(report.dates.totalDays, 30);

  const boundary = (await call("get_salary_cycle_summary", { cycleMonth: "2026-11" })).structuredContent;
  assert.deepEqual([boundary.dates.startDate, boundary.dates.endDate], ["2026-10-25", "2026-11-24"]);
  assert.equal(boundary.spending.total, 1000);

  const prompt = await mcpCall({ jsonrpc: "2.0", id: 1, method: "prompts/get", params: { name: "salary_cycle_checkup", arguments: { cycleMonth: "2026-10", salaryDay: 5 } } }, accessToken);
  const text = ((await prompt.json()) as { result: { messages: { content: { text: string } }[] } }).result.messages[0].content.text;
  assert.ok(text.includes("2026-09-25 to 2026-10-24"));
  assert.ok(text.includes("ignoredParameters"));
});

test("MCP budget period output carries showBy and update_settings stores it", async t => {
  const { accessToken, mcpCall, financeStore } = await createTestFixture(t);
  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await mcpCall({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }, accessToken);
    return ((await res.json()) as { result: any }).result;
  }
  assert.equal((await call("update_settings", { timezone: "UTC" })).isError, false);
  assert.equal((await call("get_budget_period")).structuredContent.showBy, "calendar_month");
  assert.equal((await call("update_settings", { showBy: "pay_cycle" })).isError, false);
  assert.equal((await call("get_budget_period")).structuredContent.showBy, "pay_cycle");
  assert.equal((await call("update_settings", { showBy: "weekly" })).isError, true);
  assert.equal((await call("get_budget_period")).structuredContent.showBy, "pay_cycle", "a rejected value writes nothing");
  assert.ok(financeStore.settings.size > 0);
});

test("MCP update_settings schema lists showBy with its two values", async t => {
  const { accessToken, mcpCall } = await createTestFixture(t);
  const res = await mcpCall({ jsonrpc: "2.0", id: 1, method: "tools/list" }, accessToken);
  const tools = ((await res.json()) as { result: { tools: { name: string; inputSchema: { properties: Record<string, { enum?: string[] }> } }[] } }).result.tools;
  const update = tools.find(tool => tool.name === "update_settings");
  assert.deepEqual(update?.inputSchema.properties.showBy.enum, ["calendar_month", "pay_cycle"]);
});
