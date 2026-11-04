import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { neon } from "@neondatabase/serverless";
import { createStore } from "../src/server/auth/store";
import { hashToken, newToken } from "../src/server/auth/crypto";

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;

type Rows = Array<Record<string, unknown>>;
type Query = (text: string, params?: unknown[]) => Promise<Rows>;

async function waitForRow(query: Query, text: string, params: unknown[]): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await query(text, params);
    if (rows[0]) return rows[0];
    await delay(25);
  }
  throw new Error("Timed out observing the expected database lock state");
}

async function sleepingBackend(query: Query, statement: string): Promise<number> {
  const row = await waitForRow(query,
    "SELECT pid FROM pg_stat_activity WHERE query = $1 AND wait_event = 'PgSleep'", [statement]);
  return Number(row.pid);
}

test("Neon: atomic concurrent rotation, historical replay, expiry, and shared login limits", { skip: !databaseUrl }, async () => {
  // Use an isolated, already-migrated test database. No schema creation here.
  const store = createStore(databaseUrl!);
  const otherWorker = createStore(databaseUrl!);
  const sql = neon(databaseUrl!);
  const email = `auth-test-${randomUUID()}@example.com`;
  const tokens = () => ({ accessHash: hashToken(newToken()), refreshHash: hashToken(newToken()) });
  const original = tokens();
  const limitKey = hashToken(randomUUID());
  let userId: string | undefined;
  try {
    const user = await store.register("Concurrency test", email, "unused-test-password-hash", original);
    assert.ok(user);
    userId = user.id;
    assert.equal(await otherWorker.register("Duplicate", email, "unused", tokens()), undefined);
    const candidates = [tokens(), tokens()];
    const rotated = await Promise.all([store.rotate(original.refreshHash, candidates[0]), otherWorker.rotate(original.refreshHash, candidates[1])]);
    assert.equal(rotated.filter(Boolean).length, 1);
    assert.equal(await store.authenticate(original.accessHash), undefined);
    for (const candidate of candidates) assert.equal(await store.authenticate(candidate.accessHash), undefined);
    const state = await sql.query("SELECT revoked_at FROM auth_sessions WHERE user_id = $1", [user.id]);
    assert.ok(state[0].revoked_at);

    const first = tokens();
    const second = tokens();
    await store.createSession(user.id, first);
    assert.ok(await store.rotate(first.refreshHash, second));
    assert.ok(await otherWorker.authenticate(second.accessHash));
    await otherWorker.revoke(first.refreshHash);
    assert.equal(await store.authenticate(second.accessHash), undefined);

    const expiring = tokens();
    await store.createSession(user.id, expiring);
    await sql.query("UPDATE auth_sessions SET access_expires_at = now() - interval '1 second' WHERE access_hash = $1", [expiring.accessHash]);
    assert.equal(await store.authenticate(expiring.accessHash), undefined);
    // Expired access does not prevent valid refresh.
    const renewed = tokens();
    assert.ok(await store.rotate(expiring.refreshHash, renewed));
    await sql.query("UPDATE auth_sessions SET refresh_expires_at = now() - interval '1 second' WHERE access_hash = $1", [renewed.accessHash]);
    assert.equal(await store.authenticate(renewed.accessHash), undefined);
    assert.equal(await store.rotate(renewed.refreshHash, tokens()), undefined);

    const attempts = await Promise.all(Array.from({ length: 11 }, (_, i) => (i % 2 ? store : otherWorker).reserveAttempt(limitKey)));
    assert.equal(attempts.filter(Boolean).length, 10);
    await sql.query("UPDATE auth_login_limits SET window_started_at = now() - interval '16 minutes' WHERE key_hash = $1", [limitKey]);
    assert.equal(await store.reserveAttempt(limitKey), true);
  } finally {
    if (userId) await sql.query("DELETE FROM auth_users WHERE id = $1", [userId]);
    await sql.query("DELETE FROM auth_login_limits WHERE key_hash = $1", [limitKey]);
  }
});

test("Neon: bearer-only logout retains its target while a concurrent refresh changes the access hash", { skip: !databaseUrl, timeout: 30000 }, async () => {
  const store = createStore(databaseUrl!);
  const sql = neon(databaseUrl!);
  const query: Query = async (text, params = []) => await sql.query(text, params) as Rows;
  const original = { accessHash: hashToken(newToken()), refreshHash: hashToken(newToken()) };
  const replacementHash = hashToken(newToken());
  const user = await store.register("Logout race", `auth-race-${randomUUID()}@example.com`, "unused-test-password-hash", original);
  assert.ok(user);
  const sleepStatement = `SELECT pg_sleep(8) /* auth-logout-race-${randomUUID()} */`;
  let revoking: Promise<unknown> | undefined;
  // Hold an uncommitted access-hash replacement, just as a refresh update does.
  // Logout's snapshot still sees the old hash, but its UPDATE must wait.
  const holding = sql.transaction([
    sql.query("UPDATE auth_sessions SET access_hash = $2 WHERE access_hash = $1", [original.accessHash, replacementHash]),
    sql.query(sleepStatement),
  ]).then(() => undefined, () => new Error("Lock-holder transaction failed"));
  try {
    const blocker = await sleepingBackend(query, sleepStatement);
    revoking = store.revoke(undefined, original.accessHash)
      .then(() => undefined, () => new Error("Bearer revocation failed"));
    await waitForRow(query,
      "SELECT pid FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))", [blocker]);
    assert.equal(await holding, undefined);
    assert.equal(await revoking, undefined);
    const rows = await query("SELECT access_hash, revoked_at FROM auth_sessions WHERE user_id = $1", [user.id]);
    assert.equal(rows[0].access_hash, replacementHash);
    assert.ok(rows[0].revoked_at, "logout must revoke the resolved family after its access hash changes");
    assert.equal(await store.authenticate(replacementHash), undefined);
  } finally {
    await holding;
    await revoking;
    await query("DELETE FROM auth_users WHERE id = $1", [user.id]);
  }
});

test("Neon: limiter uses one statement time when a lock wait crosses window expiry", { skip: !databaseUrl, timeout: 30000 }, async () => {
  const store = createStore(databaseUrl!);
  const sql = neon(databaseUrl!);
  const query: Query = async (text, params = []) => await sql.query(text, params) as Rows;
  const key = hashToken(randomUUID());
  await query("INSERT INTO auth_login_limits (key_hash, window_started_at, attempts) VALUES ($1, statement_timestamp(), 10)", [key]);
  const sleepStatement = `SELECT pg_sleep(8) /* auth-limit-race-${randomUUID()} */`;
  let reserving: Promise<boolean | Error> | undefined;
  // Make the exhausted window expire during the wait, not before the attempt
  // reaches PostgreSQL. The pending statement must use its own start time.
  const holding = sql.transaction([
    sql.query(`UPDATE auth_login_limits SET window_started_at = statement_timestamp() - interval '15 minutes' + interval '5 seconds'
      WHERE key_hash = $1 RETURNING window_started_at`, [key]),
    sql.query(sleepStatement),
  ]).then((rows: Rows[]) => ({ rows, error: undefined }), () => ({ rows: undefined, error: new Error("Lock-holder transaction failed") }));
  try {
    const blocker = await sleepingBackend(query, sleepStatement);
    reserving = store.reserveAttempt(key).catch(() => new Error("Attempt reservation failed"));
    const waiting = await waitForRow(query,
      "SELECT query_start FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))", [blocker]);
    const held = await holding;
    assert.equal(held.error, undefined);
    const previousStart = String(held.rows![0][0].window_started_at);
    assert.ok(new Date(String(waiting.query_start)).getTime() < new Date(previousStart).getTime() + 900000,
      "test precondition: reservation must start before window expiry");
    assert.equal(await reserving, false, "a pre-expiry exhausted attempt must not reset during its lock wait");
    const exhausted = await query("SELECT attempts, window_started_at FROM auth_login_limits WHERE key_hash = $1", [key]);
    assert.equal(Number(exhausted[0].attempts), 11);
    assert.equal(String(exhausted[0].window_started_at), previousStart);
    assert.equal(await store.reserveAttempt(key), true, "a subsequent post-expiry statement resets the window");
    const reset = await query("SELECT attempts, window_started_at FROM auth_login_limits WHERE key_hash = $1", [key]);
    assert.equal(Number(reset[0].attempts), 1);
    assert.notEqual(String(reset[0].window_started_at), previousStart);
  } finally {
    await holding;
    await reserving;
    await query("DELETE FROM auth_login_limits WHERE key_hash = $1", [key]);
  }
});

test("Neon: deleteAccount removes the user and cascades to every user-owned table", { skip: !databaseUrl, timeout: 30000 }, async () => {
  // Opt in only against an isolated database with migrations 001–006 applied.
  const store = createStore(databaseUrl!);
  const sql = neon(databaseUrl!);
  const tokens = { accessHash: hashToken(newToken()), refreshHash: hashToken(newToken()) };
  const keep = randomUUID();
  let userId: string | undefined;
  try {
    // Every foreign key into auth_users must cascade, so a new table cannot silently block or orphan deletion.
    const foreignKeys = await sql.query(`SELECT c.conrelid::regclass::text AS table_name, c.confdeltype
      FROM pg_constraint c WHERE c.contype = 'f' AND c.confrelid = 'auth_users'::regclass`);
    assert.ok(foreignKeys.length > 0);
    for (const fk of foreignKeys) assert.equal(fk.confdeltype, "c", `${fk.table_name} must reference auth_users ON DELETE CASCADE`);

    const user = await store.register("Delete test", `delete-${randomUUID()}@example.com`, "unused-test-password-hash", tokens);
    assert.ok(user);
    userId = user.id;
    await sql.query("INSERT INTO auth_users (id, name, email, password_hash) VALUES ($1, 'Bystander', $2, 'unused')", [keep, `keep-${keep}@example.test`]);
    const ruleId = randomUUID();
    for (const owner of [userId, keep]) {
      const rule = owner === userId ? ruleId : randomUUID();
      await sql.query("INSERT INTO finance_settings (user_id, categories) VALUES ($1, '[]')", [owner]);
      await sql.query(`INSERT INTO finance_repeat_rules (id, user_id, amount, description, category, start_date, time, frequency, end_type)
        VALUES ($1, $2, 1, '', 'Food', '2026-11-01', '08:00', 'daily', 'unlimited')`, [rule, owner]);
      await sql.query(`INSERT INTO finance_spendings (id, user_id, amount, description, category, date, time, repeat_rule_id)
        VALUES ($1, $2, 1, '', 'Food', '2026-11-03', '08:00', $3)`, [randomUUID(), owner, rule]);
      await sql.query(`INSERT INTO finance_incomes (id, user_id, source, amount, frequency, start_date)
        VALUES ($1, $2, 'Salary', 1, 'monthly', '2026-11-01')`, [randomUUID(), owner]);
      await sql.query("INSERT INTO finance_income_migrations (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [owner]);
      await sql.query(`INSERT INTO finance_income_entries (id, user_id, month, amount, description)
        VALUES ($1, $2, '2026-11-01', 1, 'Legacy')`, [randomUUID(), owner]);
    }
    const apiKeyHash = hashToken(newToken());
    await store.createApiKey!(userId, { name: "Agent", keyPrefix: "mf_pat_…", keyHash: apiKeyHash, expiresAt: null });
    assert.ok(await store.authenticateApiKey!(apiKeyHash));

    const tables = foreignKeys.map(fk => String(fk.table_name));
    const ownedRows = async (owner: string) => {
      const counts: Record<string, number> = {};
      for (const table of tables) {
        counts[table] = Number((await sql.query(`SELECT count(*) AS n FROM ${table} WHERE user_id = $1`, [owner]))[0].n);
      }
      counts.auth_refresh_tokens = Number((await sql.query(
        "SELECT count(*) AS n FROM auth_refresh_tokens r JOIN auth_sessions s ON s.id = r.session_id WHERE s.user_id = $1", [owner]))[0].n);
      return counts;
    };
    const before = await ownedRows(userId);
    for (const [table, count] of Object.entries(before)) assert.ok(count > 0, `fixture has rows in ${table}`);
    const bystanderBefore = await ownedRows(keep);

    assert.equal(await store.deleteAccount(userId), true);
    assert.equal(await store.deleteAccount(userId), false);
    assert.deepEqual((await sql.query("SELECT id FROM auth_users WHERE id = $1", [userId])), []);
    for (const [table, count] of Object.entries(await ownedRows(userId))) assert.equal(count, 0, `${table} still has rows`);
    assert.equal(await store.authenticate(tokens.accessHash), undefined);
    assert.equal(await store.authenticateApiKey!(apiKeyHash), undefined);
    assert.deepEqual(await ownedRows(keep), bystanderBefore, "other users are untouched");
  } finally {
    for (const id of [userId, keep]) if (id) await sql.query("DELETE FROM auth_users WHERE id = $1", [id]);
  }
});
