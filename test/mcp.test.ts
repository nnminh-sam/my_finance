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
  type Spending,
  type SpendingInput,
} from "../src/server/finance/model";
import { formatDateUtc, generateOccurrences, isRuleDueForSync } from "../src/server/finance/recurrence";
import type { FinanceStore } from "../src/server/finance/store";

class MemoryAuthStore implements AuthStore {
  accounts = new Map<string, Account>();
  attempts = new Map<string, number>();
  sessions: Array<TokenHashes & { userId: string; revoked: boolean; expired: boolean; history: Set<string> }> = [];
  apiKeys = new Map<string, ApiKeyRecord & { userId: string; keyHash: string; revokedAt: string | null }>();

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
  async updateSettings(userId: string, patch: Partial<FinanceSettings>) {
    const next = { ...(await this.getSettings(userId)), ...structuredClone(patch) };
    this.settings.set(userId, next);
    return structuredClone(next);
  }
  async listSpendings(userId: string, limit: number, cursor?: string, startDate?: string, endDate?: string) {
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
    const income: Income = { id, ...input };
    this.incomeRows(userId).set(id, income);
    return structuredClone(income);
  }
  async deleteIncome(userId: string, id: string) {
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

  // 6. Create and list repeat rule
  const repeatCreated = await callTool("create_repeat_rule", {
    amount: 200000,
    description: "Gym membership",
    category: "Other",
    startDate: "2026-10-01",
    time: "09:00",
    frequency: "monthly",
    endType: "unlimited",
  });
  assert.equal(repeatCreated.isError, false);

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
