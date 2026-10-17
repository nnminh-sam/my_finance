import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { neon } from "@neondatabase/serverless";
import { createFinanceStore } from "../src/server/finance/store";
import { defaultFinanceSettings, type IncomeEntryInput, type SpendingInput } from "../src/server/finance/model";

const databaseUrl = process.env.FINANCE_TEST_DATABASE_URL;
const input: SpendingInput = { amount: 0.29, description: "Neon test", category: "Food", date: "2024-02-29", time: "23:59" };

test("Neon finance: defaults, cross-worker partial settings, scoped CRUD, historical categories and full pagination", { skip: !databaseUrl, timeout: 30000 }, async () => {
  // Opt in only against an isolated database with both checked-in migrations applied.
  const sql = neon(databaseUrl!);
  const store = createFinanceStore(databaseUrl!);
  const otherWorker = createFinanceStore(databaseUrl!);
  const users = [randomUUID(), randomUUID()];
  try {
    for (const id of users) await sql.query("INSERT INTO auth_users (id, name, email, password_hash) VALUES ($1, 'Finance test', $2, 'unused')", [id, `finance-${id}@example.test`]);
    const [initial, sameInitial] = await Promise.all([store.getSettings(users[0]), otherWorker.getSettings(users[0])]);
    assert.deepEqual(initial, defaultFinanceSettings());
    assert.deepEqual(sameInitial, initial);
    assert.deepEqual(Object.keys(initial).sort(), ["avatar", "categories", "income"]);
    const legacyColumns = "SELECT base_daily_spending, max_daily_spending FROM finance_settings WHERE user_id = $1";
    const legacyDefaults = await sql.query(legacyColumns, [users[0]]);
    assert.equal(Number(legacyDefaults[0].base_daily_spending), 0);
    assert.equal(Number(legacyDefaults[0].max_daily_spending), 0);
    await sql.query("UPDATE finance_settings SET base_daily_spending = 10.01, max_daily_spending = 20.02 WHERE user_id = $1", [users[0]]);
    const legacyValues = await sql.query(legacyColumns, [users[0]]);
    assert.deepEqual(await otherWorker.getSettings(users[0]), initial);
    assert.deepEqual(await store.listSpendings(users[0], 500), { spendings: [], nextCursor: null });
    const avatar = "https://example.test/avatar.png";
    const updates = await Promise.all([store.updateSettings(users[0], { income: 100.29 }), otherWorker.updateSettings(users[0], { avatar })]);
    for (const updated of updates) assert.deepEqual(Object.keys(updated).sort(), ["avatar", "categories", "income"]);
    const updated = { ...initial, income: 100.29, avatar };
    assert.deepEqual(await otherWorker.getSettings(users[0]), updated);
    assert.deepEqual(await store.updateSettings(users[0], {}), updated);
    assert.deepEqual(await sql.query(legacyColumns, [users[0]]), legacyValues);
    assert.deepEqual(await store.getSettings(users[1]), defaultFinanceSettings());

    const spending = await store.createSpending(users[0], input);
    assert.ok(spending);
    assert.deepEqual(spending, { id: spending.id, ...input });
    assert.equal(typeof spending.amount, "number");
    assert.equal(await otherWorker.updateSpending(users[1], spending.id, input), "not-found");
    assert.equal(await otherWorker.deleteSpending(users[1], spending.id), false);
    assert.deepEqual(await store.listSpendings(users[1], 500), { spendings: [], nextCursor: null });
    const changed = { ...input, amount: 1e12, date: "0001-01-01", time: "00:00" };
    assert.deepEqual(await otherWorker.updateSpending(users[0], spending.id, changed), { id: spending.id, ...changed });
    await store.updateSettings(users[0], { categories: [] });
    assert.equal(await store.createSpending(users[0], input), undefined);
    assert.equal(await store.updateSpending(users[0], spending.id, input), "invalid-category");
    assert.equal((await store.listSpendings(users[0], 500)).spendings[0].category, "Food");
    assert.equal(await store.deleteSpending(users[0], spending.id), true);
    assert.equal(await otherWorker.deleteSpending(users[0], spending.id), false);
    assert.equal(await store.updateSpending(users[0], spending.id, input), "not-found");
    assert.deepEqual(await store.updateSettings(users[0], { categories: initial.categories }), updated);
    assert.deepEqual(await sql.query(legacyColumns, [users[0]]), legacyValues);

    // Test fixtures only: production migrations and reads never seed spendings.
    const ids = Array.from({ length: 503 }, () => randomUUID()).sort();
    await sql.query(`INSERT INTO finance_spendings (id, user_id, amount, description, category, date, time)
      SELECT id::uuid, $1, 1.23, 'Pagination fixture', 'Food', DATE '9999-12-31', TIME '12:05'
      FROM jsonb_array_elements_text($2::jsonb) AS ids(id)`, [users[0], JSON.stringify(ids)]);
    const first = await store.listSpendings(users[0], 500);
    assert.deepEqual(first.spendings.map(row => row.id), ids.slice(0, 500));
    assert.equal(first.nextCursor, ids[499]);
    assert.equal(first.spendings[0].date, "9999-12-31");
    assert.equal(first.spendings[0].time, "12:05");
    await otherWorker.deleteSpending(users[0], first.nextCursor!);
    const second = await store.listSpendings(users[0], 500, first.nextCursor!);
    assert.deepEqual(second.spendings.map(row => row.id), ids.slice(500));
    assert.equal(second.nextCursor, null);
  } finally {
    for (const id of users) await sql.query("DELETE FROM auth_users WHERE id = $1", [id]);
  }
});

test("Neon finance: category checks see settings committed while waiting for the user lock", { skip: !databaseUrl, timeout: 30000 }, async () => {
  const sql = neon(databaseUrl!);
  const store = createFinanceStore(databaseUrl!);
  const userId = randomUUID();
  await sql.query("INSERT INTO auth_users (id, name, email, password_hash) VALUES ($1, 'Finance race', $2, 'unused')", [userId, `finance-race-${userId}@example.test`]);
  let holding: Promise<unknown> | undefined;
  let creating: Promise<unknown> | undefined;
  let updating: Promise<unknown> | undefined;
  async function waitFor(text: string, params: unknown[]) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = await sql.query(text, params);
      if (rows[0]) return rows[0];
      await delay(25);
    }
    throw new Error("Timed out observing finance lock state");
  }
  try {
    const spending = await store.createSpending(userId, input);
    assert.ok(spending);
    const sleep = `SELECT pg_sleep(8) /* finance-category-race-${randomUUID()} */`;
    holding = sql.transaction([
      sql.query("UPDATE finance_settings SET categories = '[]'::jsonb WHERE user_id = $1", [userId]),
      sql.query(sleep),
    ]).then(() => undefined, () => new Error("Finance lock-holder failed"));
    const blocker = await waitFor("SELECT pid FROM pg_stat_activity WHERE query = $1 AND wait_event = 'PgSleep'", [sleep]);
    creating = store.createSpending(userId, input).catch(() => new Error("Finance creation failed"));
    updating = store.updateSpending(userId, spending.id, input).catch(() => new Error("Finance update failed"));
    await waitFor("SELECT pid FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))", [Number(blocker.pid)]);
    assert.equal(await holding, undefined);
    assert.equal(await creating, undefined, "new spending must reject the now-removed category");
    assert.equal(await updating, "invalid-category", "updates must use the post-lock settings snapshot");
    assert.deepEqual(await store.listSpendings(userId, 500), { spendings: [spending], nextCursor: null });
  } finally {
    await holding;
    await creating;
    await updating;
    await sql.query("DELETE FROM auth_users WHERE id = $1", [userId]);
  }
});

test("Neon income entries: independent additive CRUD, ownership, constraints, pagination and cascading cleanup", { skip: !databaseUrl, timeout: 30000 }, async () => {
  // Opt in only against an isolated database with migrations 001–003 applied.
  const sql = neon(databaseUrl!);
  const store = createFinanceStore(databaseUrl!);
  const otherWorker = createFinanceStore(databaseUrl!);
  const users = [randomUUID(), randomUUID()];
  const income: IncomeEntryInput = { month: "2024-02", amount: 0.29, description: "Bonus" };
  try {
    for (const id of users) await sql.query("INSERT INTO auth_users (id, name, email, password_hash) VALUES ($1, 'Income test', $2, 'unused')", [id, `income-${id}@example.test`]);
    assert.deepEqual(await store.listIncomeEntries(users[0], 500), { incomeEntries: [], nextCursor: null });
    const [first, second] = await Promise.all([
      store.createIncomeEntry(users[0], income),
      otherWorker.createIncomeEntry(users[0], { ...income, description: "Freelance" }),
    ]);
    assert.deepEqual(first, { id: first.id, ...income });
    assert.equal(typeof first.amount, "number");
    assert.notEqual(first.id, second.id);
    assert.deepEqual((await otherWorker.listIncomeEntries(users[0], 500)).incomeEntries, [first, second].sort((a, b) => a.id < b.id ? -1 : 1));
    assert.deepEqual(await sql.query("SELECT user_id FROM finance_settings WHERE user_id = $1", [users[0]]), [], "income CRUD must not initialize or lock settings");
    assert.equal(await otherWorker.updateIncomeEntry(users[1], first.id, income), undefined);
    assert.equal(await otherWorker.deleteIncomeEntry(users[1], first.id), false);
    assert.deepEqual(await store.listIncomeEntries(users[1], 500), { incomeEntries: [], nextCursor: null });
    const recurring = await store.updateSettings(users[0], { income: 2000, categories: [] });
    const changed = { month: "0001-01", amount: 1e12, description: "a".repeat(500) };
    assert.deepEqual(await otherWorker.updateIncomeEntry(users[0], first.id, changed), { id: first.id, ...changed });
    const lastMonth = await store.createIncomeEntry(users[0], { month: "9999-12", amount: 0.01, description: "Minimum" });
    assert.equal(lastMonth.month, "9999-12");
    assert.equal(lastMonth.amount, 0.01);
    assert.deepEqual(await store.getSettings(users[0]), recurring);
    assert.deepEqual(await sql.query("SELECT to_char(month, 'YYYY-MM-DD') AS month FROM finance_income_entries WHERE user_id = $1 AND id = $2", [users[0], first.id]), [{ month: "0001-01-01" }]);
    assert.equal(await store.deleteIncomeEntry(users[0], first.id), true);
    assert.equal(await otherWorker.deleteIncomeEntry(users[0], first.id), false);
    assert.equal(await store.updateIncomeEntry(users[0], first.id, income), undefined);
    assert.equal(await store.updateIncomeEntry(users[0], randomUUID(), income), undefined);
    assert.equal(await store.deleteIncomeEntry(users[0], randomUUID()), false);
    assert.equal(await store.deleteIncomeEntry(users[0], second.id), true);
    assert.equal(await store.deleteIncomeEntry(users[0], lastMonth.id), true);

    const invalidRows: [string, number, string][] = [
      ["2024-02-02", 1, "Not first day"], ["0001-01-01 BC", 1, "Before range"], ["10000-01-01", 1, "After range"],
      ["2024-02-01", 0, "Zero"], ["2024-02-01", -1, "Negative"], ["2024-02-01", 1e12 + 1, "Too large"],
      ["2024-02-01", 1, ""], ["2024-02-01", 1, "   "], ["2024-02-01", 1, "a".repeat(501)],
    ];
    for (const [month, amount, description] of invalidRows) {
      await assert.rejects(sql.query("INSERT INTO finance_income_entries (id, user_id, month, amount, description) VALUES ($1, $2, $3::date, $4, $5)", [randomUUID(), users[0], month, amount, description]));
    }
    await assert.rejects(sql.query("INSERT INTO finance_income_entries (id, user_id, month, amount, description) VALUES ($1, $2, DATE '2024-02-01', 1, 'Missing owner')", [randomUUID(), randomUUID()]));
    assert.deepEqual(await store.listIncomeEntries(users[0], 500), { incomeEntries: [], nextCursor: null });

    // Test data only: production migrations and reads never seed income entries.
    const ids = Array.from({ length: 503 }, () => randomUUID()).sort();
    await sql.query(`INSERT INTO finance_income_entries (id, user_id, month, amount, description)
      SELECT id::uuid, $1, DATE '9999-12-01', 1.23, 'Pagination fixture'
      FROM jsonb_array_elements_text($2::jsonb) AS ids(id)`, [users[0], JSON.stringify(ids)]);
    const firstPage = await otherWorker.listIncomeEntries(users[0], 500);
    assert.deepEqual(firstPage.incomeEntries.map(row => row.id), ids.slice(0, 500));
    assert.equal(firstPage.nextCursor, ids[499]);
    assert.equal(firstPage.incomeEntries[0].month, "9999-12");
    assert.equal(firstPage.incomeEntries[0].amount, 1.23);
    assert.equal(await store.deleteIncomeEntry(users[0], firstPage.nextCursor!), true);
    const secondPage = await store.listIncomeEntries(users[0], 500, firstPage.nextCursor!);
    assert.deepEqual(secondPage.incomeEntries.map(row => row.id), ids.slice(500));
    assert.equal(secondPage.nextCursor, null);
    assert.deepEqual(await otherWorker.listIncomeEntries(users[0], 500, ids[502]), { incomeEntries: [], nextCursor: null });
    const other = await store.createIncomeEntry(users[1], income);
    assert.deepEqual((await otherWorker.listIncomeEntries(users[0], 500, other.id)).incomeEntries.map(row => row.id), ids.filter(id => id > other.id && id !== ids[499]).slice(0, 500));
    assert.deepEqual(await store.listIncomeEntries(users[1], 500), { incomeEntries: [other], nextCursor: null });
    assert.deepEqual(await store.getSettings(users[0]), recurring);
    await sql.query("DELETE FROM auth_users WHERE id = $1", [users[0]]);
    assert.deepEqual(await sql.query("SELECT id FROM finance_income_entries WHERE user_id = $1", [users[0]]), []);
  } finally {
    for (const id of users) await sql.query("DELETE FROM auth_users WHERE id = $1", [id]);
  }
});

test("Neon income entries: CRUD does not wait for the recurring settings lock", { skip: !databaseUrl, timeout: 30000 }, async () => {
  const sql = neon(databaseUrl!);
  const store = createFinanceStore(databaseUrl!);
  const userId = randomUUID();
  let holding: Promise<unknown> | undefined;
  try {
    await sql.query("INSERT INTO auth_users (id, name, email, password_hash) VALUES ($1, 'Income lock test', $2, 'unused')", [userId, `income-lock-${userId}@example.test`]);
    await store.getSettings(userId);
    const sleep = `SELECT pg_sleep(8) /* finance-income-lock-${randomUUID()} */`;
    holding = sql.transaction([
      sql.query("UPDATE finance_settings SET income = 1234 WHERE user_id = $1", [userId]),
      sql.query(sleep),
    ]).then(() => undefined, () => new Error("Income settings lock-holder failed"));
    const deadline = Date.now() + 5000;
    let sleeping = false;
    while (Date.now() < deadline) {
      const rows = await sql.query("SELECT pid FROM pg_stat_activity WHERE query = $1 AND wait_event = 'PgSleep'", [sleep]);
      if (rows[0]) { sleeping = true; break; }
      await delay(25);
    }
    assert.ok(sleeping, "must observe the recurring settings lock before testing income writes");
    const income = { month: "2024-02", amount: 1.23, description: "Independent bonus" };
    const entry = await store.createIncomeEntry(userId, income);
    assert.deepEqual(await store.updateIncomeEntry(userId, entry.id, { ...income, amount: 2.34 }), { id: entry.id, ...income, amount: 2.34 });
    assert.equal((await store.listIncomeEntries(userId, 500)).incomeEntries.length, 1);
    assert.equal(await store.deleteIncomeEntry(userId, entry.id), true);
    assert.equal((await sql.query("SELECT pid FROM pg_stat_activity WHERE query = $1 AND wait_event = 'PgSleep'", [sleep])).length, 1, "income CRUD must complete while settings remain locked");
    assert.equal(await holding, undefined);
    assert.equal((await store.getSettings(userId)).income, 1234);
  } finally {
    await holding;
    await sql.query("DELETE FROM auth_users WHERE id = $1", [userId]);
  }
});
