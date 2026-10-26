import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { neon } from "@neondatabase/serverless";
import { createFinanceStore } from "../src/server/finance/store";
import { readFile } from "node:fs/promises";
import { defaultFinanceSettings, type IncomeInput, type SpendingInput } from "../src/server/finance/model";

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
    assert.deepEqual(Object.keys(initial).sort(), ["avatar", "categories"]);
    const legacyColumns = "SELECT base_daily_spending, max_daily_spending FROM finance_settings WHERE user_id = $1";
    const legacyDefaults = await sql.query(legacyColumns, [users[0]]);
    assert.equal(Number(legacyDefaults[0].base_daily_spending), 0);
    assert.equal(Number(legacyDefaults[0].max_daily_spending), 0);
    await sql.query("UPDATE finance_settings SET base_daily_spending = 10.01, max_daily_spending = 20.02 WHERE user_id = $1", [users[0]]);
    const legacyValues = await sql.query(legacyColumns, [users[0]]);
    assert.deepEqual(await otherWorker.getSettings(users[0]), initial);
    assert.deepEqual(await store.listSpendings(users[0], 500), { spendings: [], nextCursor: null });
    const avatar = "https://example.test/avatar.png";
    const updates = await Promise.all([store.updateSettings(users[0], { categories: initial.categories }), otherWorker.updateSettings(users[0], { avatar })]);
    for (const updated of updates) assert.deepEqual(Object.keys(updated).sort(), ["avatar", "categories"]);
    const updated = { ...initial, avatar };
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

test("Neon incomes: owner-scoped CRUD, constraints, pagination and cascading cleanup", { skip: !databaseUrl, timeout: 30000 }, async () => {
  // Opt in only against an isolated database with migrations 001–005 applied.
  const sql = neon(databaseUrl!);
  const store = createFinanceStore(databaseUrl!);
  const otherWorker = createFinanceStore(databaseUrl!);
  const users = [randomUUID(), randomUUID()];
  const income: IncomeInput = { source: "Salary", name: "Company", amount: 0.29, frequency: "monthly", startDate: "2024-02-29", endDate: null };
  try {
    for (const id of users) await sql.query("INSERT INTO auth_users (id, name, email, password_hash) VALUES ($1, 'Income test', $2, 'unused')", [id, `income-${id}@example.test`]);
    assert.deepEqual(await store.listIncomes(users[0], 500), { incomes: [], nextCursor: null });
    const [first, second] = await Promise.all([
      store.createIncome(users[0], income),
      otherWorker.createIncome(users[0], { ...income, source: "Gift", name: "", frequency: "once" }),
    ]);
    assert.deepEqual(first, { id: first.id, ...income });
    assert.equal(typeof first.amount, "number");
    assert.notEqual(first.id, second.id);
    assert.deepEqual((await otherWorker.listIncomes(users[0], 500)).incomes, [first, second].sort((a, b) => a.id < b.id ? -1 : 1));
    assert.deepEqual(await sql.query("SELECT user_id FROM finance_settings WHERE user_id = $1", [users[0]]), [], "income CRUD must not initialize or lock settings");
    assert.equal(await otherWorker.updateIncome(users[1], first.id, income), undefined);
    assert.equal(await otherWorker.deleteIncome(users[1], first.id), false);
    assert.deepEqual(await store.listIncomes(users[1], 500), { incomes: [], nextCursor: null });
    const changed: IncomeInput = { source: "a".repeat(100), name: "a".repeat(500), amount: 1e12, frequency: "yearly", startDate: "0001-01-01", endDate: "9999-12-31" };
    assert.deepEqual(await otherWorker.updateIncome(users[0], first.id, changed), { id: first.id, ...changed });
    for (const frequency of ["daily", "weekly"] as const) {
      const row = await store.createIncome(users[0], { ...income, frequency, amount: 0.01, endDate: "2024-03-01" });
      assert.deepEqual(row, { id: row.id, ...income, frequency, amount: 0.01, endDate: "2024-03-01" });
      assert.equal(await store.deleteIncome(users[0], row.id), true);
    }
    assert.equal(await store.deleteIncome(users[0], first.id), true);
    assert.equal(await otherWorker.deleteIncome(users[0], first.id), false);
    assert.equal(await store.updateIncome(users[0], first.id, income), undefined);
    assert.equal(await store.updateIncome(users[0], randomUUID(), income), undefined);
    assert.equal(await store.deleteIncome(users[0], randomUUID()), false);
    assert.equal(await store.deleteIncome(users[0], second.id), true);

    const insert = "INSERT INTO finance_incomes (id, user_id, source, name, amount, frequency, start_date, end_date) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date)";
    const invalidRows: [string, string, number, string, string, string | null][] = [
      ["", "", 1, "monthly", "2024-02-01", null], ["   ", "", 1, "monthly", "2024-02-01", null], ["a".repeat(101), "", 1, "monthly", "2024-02-01", null],
      ["Salary", "a".repeat(501), 1, "monthly", "2024-02-01", null], ["Salary", "", 0, "monthly", "2024-02-01", null],
      ["Salary", "", -1, "monthly", "2024-02-01", null], ["Salary", "", 1e12 + 1, "monthly", "2024-02-01", null],
      ["Salary", "", 1, "hourly", "2024-02-01", null], ["Salary", "", 1, "monthly", "0001-01-01 BC", null],
      ["Salary", "", 1, "monthly", "2024-02-01", "2024-01-31"], ["Gift", "", 1, "once", "2024-02-01", "2024-02-02"],
    ];
    for (const [source, name, amount, frequency, startDate, endDate] of invalidRows) {
      await assert.rejects(sql.query(insert, [randomUUID(), users[0], source, name, amount, frequency, startDate, endDate]), JSON.stringify([source.slice(0, 10), amount, frequency, startDate, endDate]));
    }
    await assert.rejects(sql.query(insert, [randomUUID(), randomUUID(), "Salary", "", 1, "monthly", "2024-02-01", null]));
    assert.deepEqual(await store.listIncomes(users[0], 500), { incomes: [], nextCursor: null });

    // Test data only: production reads never seed incomes.
    const ids = Array.from({ length: 503 }, () => randomUUID()).sort();
    await sql.query(`INSERT INTO finance_incomes (id, user_id, source, name, amount, frequency, start_date)
      SELECT id::uuid, $1, 'Fixture', '', 1.23, 'once', DATE '9999-12-31'
      FROM jsonb_array_elements_text($2::jsonb) AS ids(id)`, [users[0], JSON.stringify(ids)]);
    const firstPage = await otherWorker.listIncomes(users[0], 500);
    assert.deepEqual(firstPage.incomes.map(row => row.id), ids.slice(0, 500));
    assert.equal(firstPage.nextCursor, ids[499]);
    assert.deepEqual(firstPage.incomes[0], { id: ids[0], source: "Fixture", name: "", amount: 1.23, frequency: "once", startDate: "9999-12-31", endDate: null });
    assert.equal(await store.deleteIncome(users[0], firstPage.nextCursor!), true);
    const secondPage = await store.listIncomes(users[0], 500, firstPage.nextCursor!);
    assert.deepEqual(secondPage.incomes.map(row => row.id), ids.slice(500));
    assert.equal(secondPage.nextCursor, null);
    assert.deepEqual(await otherWorker.listIncomes(users[0], 500, ids[502]), { incomes: [], nextCursor: null });
    const other = await store.createIncome(users[1], income);
    assert.deepEqual((await otherWorker.listIncomes(users[0], 500, other.id)).incomes.map(row => row.id), ids.filter(id => id > other.id && id !== ids[499]).slice(0, 500));
    assert.deepEqual(await store.listIncomes(users[1], 500), { incomes: [other], nextCursor: null });
    await sql.query("DELETE FROM auth_users WHERE id = $1", [users[0]]);
    assert.deepEqual(await sql.query("SELECT id FROM finance_incomes WHERE user_id = $1", [users[0]]), []);
  } finally {
    for (const id of users) await sql.query("DELETE FROM auth_users WHERE id = $1", [id]);
  }
});

test("Neon migration 005 copies legacy income once and never restores deleted rows on rerun", { skip: !databaseUrl, timeout: 30000 }, async () => {
  const sql = neon(databaseUrl!);
  const store = createFinanceStore(databaseUrl!);
  const migration = await readFile(new URL("../migrations/005_incomes.sql", import.meta.url), "utf8");
  const runMigration = () => sql.transaction(migration.split(";").map(statement => statement.trim()).filter(Boolean).map(statement => sql.query(statement)));
  const users = [randomUUID(), randomUUID(), randomUUID()];
  try {
    for (const id of users) await sql.query("INSERT INTO auth_users (id, name, email, password_hash, created_at) VALUES ($1, 'Migration test', $2, 'unused', TIMESTAMPTZ '2026-05-20 10:00:00+00')", [id, `migration-${id}@example.test`]);
    // A user registered before 005: recurring income, an older spending, and two additional entries.
    await store.getSettings(users[0]);
    await sql.query("UPDATE finance_settings SET income = 20000000 WHERE user_id = $1", [users[0]]);
    await sql.query("INSERT INTO finance_spendings (id, user_id, amount, description, category, date, time) VALUES ($1, $2, 1, '', 'Food', DATE '2026-03-14', TIME '12:00')", [randomUUID(), users[0]]);
    const entries = [randomUUID(), randomUUID()];
    await sql.query(`INSERT INTO finance_income_entries (id, user_id, month, amount, description) VALUES
      ($1, $3, DATE '2026-06-01', 5000000, 'Performance bonus'), ($2, $3, DATE '2026-07-01', 0.29, 'Gift')`, [...entries, users[0]]);
    // A user with zero recurring income and no spendings gets nothing.
    // Fresh users are never marked as migrated, even when 005 already ran on this database.
    await store.getSettings(users[1]);

    await runMigration();
    const copied = (await store.listIncomes(users[0], 500)).incomes.sort((a, b) => a.startDate.localeCompare(b.startDate));
    assert.deepEqual(copied, [
      { id: users[0], source: "Salary", name: "Recurring monthly income", amount: 20000000, frequency: "monthly", startDate: "2026-03-01", endDate: null },
      { id: entries[0], source: "Other", name: "Performance bonus", amount: 5000000, frequency: "once", startDate: "2026-06-01", endDate: null },
      { id: entries[1], source: "Other", name: "Gift", amount: 0.29, frequency: "once", startDate: "2026-07-01", endDate: null },
    ]);
    assert.deepEqual(await store.listIncomes(users[1], 500), { incomes: [], nextCursor: null });
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM finance_income_migrations WHERE user_id = ANY($1::uuid[])", [users]))[0].n, 3);
    // Legacy data stays untouched.
    assert.equal(Number((await sql.query("SELECT income FROM finance_settings WHERE user_id = $1", [users[0]]))[0].income), 20000000);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM finance_income_entries WHERE user_id = $1", [users[0]]))[0].n, 2);

    // The user deletes a migrated income and later legacy rows appear for another user: a rerun copies nothing.
    assert.equal(await store.deleteIncome(users[0], users[0]), true);
    await sql.query("UPDATE finance_settings SET income = 1 WHERE user_id = $1", [users[1]]);
    await runMigration();
    assert.deepEqual((await store.listIncomes(users[0], 500)).incomes.map(row => row.id).sort(), [...entries].sort());
    assert.deepEqual(await store.listIncomes(users[1], 500), { incomes: [], nextCursor: null });
  } finally {
    for (const id of users) await sql.query("DELETE FROM auth_users WHERE id = $1", [id]);
  }
});

test("Neon incomes: CRUD does not wait for the settings lock", { skip: !databaseUrl, timeout: 30000 }, async () => {
  const sql = neon(databaseUrl!);
  const store = createFinanceStore(databaseUrl!);
  const userId = randomUUID();
  let holding: Promise<unknown> | undefined;
  try {
    await sql.query("INSERT INTO auth_users (id, name, email, password_hash) VALUES ($1, 'Income lock test', $2, 'unused')", [userId, `income-lock-${userId}@example.test`]);
    await store.getSettings(userId);
    const sleep = `SELECT pg_sleep(8) /* finance-income-lock-${randomUUID()} */`;
    holding = sql.transaction([
      sql.query("UPDATE finance_settings SET avatar = 'https://example.test/locked.png' WHERE user_id = $1", [userId]),
      sql.query(sleep),
    ]).then(() => undefined, () => new Error("Settings lock-holder failed"));
    const deadline = Date.now() + 5000;
    let sleeping = false;
    while (Date.now() < deadline) {
      const rows = await sql.query("SELECT pid FROM pg_stat_activity WHERE query = $1 AND wait_event = 'PgSleep'", [sleep]);
      if (rows[0]) { sleeping = true; break; }
      await delay(25);
    }
    assert.ok(sleeping, "must observe the settings lock before testing income writes");
    const income: IncomeInput = { source: "Freelance", name: "", amount: 1.23, frequency: "weekly", startDate: "2024-02-05", endDate: null };
    const created = await store.createIncome(userId, income);
    assert.deepEqual(await store.updateIncome(userId, created.id, { ...income, amount: 2.34 }), { id: created.id, ...income, amount: 2.34 });
    assert.equal((await store.listIncomes(userId, 500)).incomes.length, 1);
    assert.equal(await store.deleteIncome(userId, created.id), true);
    assert.equal((await sql.query("SELECT pid FROM pg_stat_activity WHERE query = $1 AND wait_event = 'PgSleep'", [sleep])).length, 1, "income CRUD must complete while settings remain locked");
    assert.equal(await holding, undefined);
    assert.equal((await store.getSettings(userId)).avatar, "https://example.test/locked.png");
  } finally {
    await holding;
    await sql.query("DELETE FROM auth_users WHERE id = $1", [userId]);
  }
});
