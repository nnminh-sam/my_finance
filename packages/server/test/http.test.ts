import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { createApplication } from "../src/application";
import { hashToken } from "../src/auth/crypto";
import type { AuthStore, Account, User, TokenHashes } from "../src/auth/store";

class MemoryStore implements AuthStore {
  accounts = new Map<string, Account>();
  attempts = new Map<string, number>();
  sessions: Array<TokenHashes & { userId: string; revoked: boolean; expired: boolean; history: Set<string> }> = [];
  fail = false;
  async reserveAttempt(key: string) {
    if (this.fail) throw new Error("postgres://secret:password@private.example/database");
    const count = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, count);
    return count <= 10;
  }
  async findAccount(email: string) { return this.accounts.get(email); }
  async register(name: string, email: string, passwordHash: string, tokens: TokenHashes) {
    if (this.accounts.has(email)) return undefined;
    const account = { id: randomUUID(), name, email, passwordHash, createdAt: new Date().toISOString() };
    this.accounts.set(email, account);
    await this.createSession(account.id, tokens);
    return this.publicUser(account.id);
  }
  async createSession(userId: string, tokens: TokenHashes) {
    this.sessions.push({ ...tokens, userId, revoked: false, expired: false, history: new Set([tokens.refreshHash]) });
  }
  publicUser(userId: string): User {
    const account = [...this.accounts.values()].find(account => account.id === userId)!;
    const { passwordHash: _hash, ...user } = account;
    return user;
  }
  async rotate(oldHash: string, tokens: TokenHashes) {
    const session = this.sessions.find(session => session.history.has(oldHash));
    if (!session) return undefined;
    if (session.revoked || session.expired || session.refreshHash !== oldHash) {
      session.revoked = true;
      return undefined;
    }
    Object.assign(session, tokens);
    session.history.add(tokens.refreshHash);
    return this.publicUser(session.userId);
  }
  async revoke(refreshHash?: string, accessHash?: string) {
    if (this.fail) throw new Error("secret database failure");
    for (const session of this.sessions) {
      if ((refreshHash && session.history.has(refreshHash)) || session.accessHash === accessHash) session.revoked = true;
    }
  }
  async authenticate(hash: string) {
    const session = this.sessions.find(session => session.accessHash === hash && !session.revoked && !session.expired);
    return session ? this.publicUser(session.userId) : undefined;
  }
}

const origin = "http://localhost:5173";
const registration = { name: "Test User", email: "TEST@example.com", password: "correct horse battery staple" };

async function fixture(t: TestContext, production = false) {
  const store = new MemoryStore();
  const app = createApplication({ databaseUrl: "unused", appOrigin: origin, production }, store);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  function post(endpoint: string, body: unknown = {}, headers: Record<string, string> = {}) {
    return fetch(`${url}/api/v1/auth/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(body) });
  }
  function me(token: string) {
    return fetch(`${url}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  }
  return { store, url, post, me };
}
function cookie(response: Response): string { return response.headers.get("set-cookie")!.split(";")[0]; }

test("registration, login, me, rotation, replay, and cookie-only logout contract", async t => {
  const { post, me, store } = await fixture(t);
  const registered = await post("register", registration);
  assert.equal(registered.status, 201);
  assert.match(registered.headers.get("set-cookie")!, /HttpOnly/);
  assert.match(registered.headers.get("set-cookie")!, /SameSite=Lax/);
  assert.match(registered.headers.get("set-cookie")!, /Path=\/api\/v1\/auth/);
  assert.equal(registered.headers.get("cache-control"), "no-store");
  const initial = await registered.json() as { user: User; accessToken: string; expiresIn: number };
  assert.equal(initial.expiresIn, 900);
  assert.equal(initial.user.email, "test@example.com");
  assert.deepEqual(Object.keys(initial.user).sort(), ["createdAt", "email", "id", "name"]);
  assert.equal(store.sessions[0].accessHash, hashToken(initial.accessToken));
  assert.equal((await me(initial.accessToken)).status, 200);
  const oldCookie = cookie(registered);
  const refreshed = await post("refresh", {}, { Cookie: oldCookie });
  assert.equal(refreshed.status, 200);
  const next = await refreshed.json() as { accessToken: string };
  assert.notEqual(initial.accessToken, next.accessToken);
  assert.equal((await me(initial.accessToken)).status, 401);
  assert.equal((await me(next.accessToken)).status, 200);
  const replay = await post("refresh", {}, { Cookie: oldCookie });
  assert.equal(replay.status, 401);
  assert.equal((await me(next.accessToken)).status, 401);
  assert.equal((await post("refresh", {}, { Cookie: cookie(refreshed) })).status, 401);
  const loggedIn = await post("login", { email: "TEST@example.com", password: registration.password });
  assert.equal(loggedIn.status, 200);
  const loginBody = await loggedIn.json() as { accessToken: string };
  const loggedOut = await post("logout", {}, { Cookie: cookie(loggedIn) });
  assert.equal(loggedOut.status, 204);
  assert.match(loggedOut.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await me(loginBody.accessToken)).status, 401);
  assert.equal((await post("logout")).status, 204);
});

test("strict origin guard includes login/logout and CORS allows only the configured origin", async t => {
  const { url, post } = await fixture(t);
  assert.equal((await post("login", {}, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await post("logout", {}, { Origin: "null" })).status, 403);
  assert.equal((await fetch(`${url}/api/v1/auth/login`, { method: "POST" })).status, 403);
  const health = await fetch(`${url}/api/v1/health`, { headers: { Origin: origin } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("access-control-allow-origin"), origin);
  assert.equal(health.headers.get("access-control-allow-credentials"), "true");
  const evil = await fetch(`${url}/api/v1/health`, { headers: { Origin: "https://evil.example" } });
  assert.notEqual(evil.headers.get("access-control-allow-origin"), "https://evil.example");
});

test("validation, generic credentials, persistent limiter contract, malformed bodies", async t => {
  const { url, post, me } = await fixture(t);
  assert.equal((await post("register", { ...registration, password: "short" })).status, 400);
  assert.equal((await me("invalid")).status, 401);
  const missing = await post("login", { email: "unknown@example.com", password: registration.password });
  const malformed = await post("login", { email: "not-an-email", password: "short" });
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), await malformed.json());
  for (let i = 0; i < 10; i++) {
    assert.equal((await post("login", { email: "limited@example.com", password: "short" })).status, 401);
  }
  const limited = await post("login", { email: " LIMITED@example.com ", password: "short" });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "900");
  const badJson = await fetch(`${url}/api/v1/auth/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{" });
  assert.equal(badJson.status, 400);
  const large = await post("login", { email: "a".repeat(20000) });
  assert.equal(large.status, 413);
});

test("concurrent refresh has one winner but replay invalidates the winner; expired access is rejected", async t => {
  const { post, me, store } = await fixture(t);
  const registered = await post("register", registration);
  const refreshCookie = cookie(registered);
  const replies = await Promise.all([post("refresh", {}, { Cookie: refreshCookie }), post("refresh", {}, { Cookie: refreshCookie })]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 401]);
  const winner = await replies.find(reply => reply.status === 200)!.json() as { accessToken: string };
  assert.equal((await me(winner.accessToken)).status, 401);
  const login = await post("login", { email: registration.email, password: registration.password });
  const body = await login.json() as { accessToken: string };
  store.sessions[1].expired = true;
  assert.equal((await me(body.accessToken)).status, 401);
  assert.equal((await post("refresh", {}, { Cookie: cookie(login) })).status, 401);
});

test("logout revokes the cookie family even when bearer belongs to a different session", async t => {
  const { post, me } = await fixture(t);
  const first = await post("register", registration);
  const firstBody = await first.json() as { accessToken: string };
  const rotated = await post("refresh", {}, { Cookie: cookie(first) });
  const rotatedBody = await rotated.json() as { accessToken: string };
  const second = await post("login", { email: registration.email, password: registration.password });
  const secondBody = await second.json() as { accessToken: string };
  const logout = await post("logout", {}, { Cookie: cookie(first), Authorization: `Bearer ${secondBody.accessToken}` });
  assert.equal(logout.status, 204);
  assert.equal((await me(firstBody.accessToken)).status, 401);
  assert.equal((await me(rotatedBody.accessToken)).status, 401);
  assert.equal((await me(secondBody.accessToken)).status, 401);
});

test("production cookies are Secure and service failures do not expose secrets", async t => {
  const { store, post } = await fixture(t, true);
  const registered = await post("register", registration);
  assert.match(registered.headers.get("set-cookie")!, /; Secure/);
  store.fail = true;
  const failed = await post("login", { email: registration.email, password: registration.password });
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "Service temporarily unavailable" });
  const logout = await post("logout", {}, { Cookie: cookie(registered) });
  assert.equal(logout.status, 503);
  assert.match(logout.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/);
});
