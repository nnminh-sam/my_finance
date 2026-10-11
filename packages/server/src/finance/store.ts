import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { defaultFinanceSettings, type FinanceSettings, type IncomeEntry, type IncomeEntryInput, type IncomeEntryPage, type Spending, type SpendingInput, type SpendingPage } from "./model";

export interface FinanceStore {
  getSettings(userId: string): Promise<FinanceSettings>;
  updateSettings(userId: string, patch: Partial<FinanceSettings>): Promise<FinanceSettings>;
  listSpendings(userId: string, limit: number, cursor?: string): Promise<SpendingPage>;
  createSpending(userId: string, input: SpendingInput): Promise<Spending | undefined>;
  updateSpending(userId: string, id: string, input: SpendingInput): Promise<Spending | "not-found" | "invalid-category">;
  deleteSpending(userId: string, id: string): Promise<boolean>;
  listIncomeEntries(userId: string, limit: number, cursor?: string): Promise<IncomeEntryPage>;
  createIncomeEntry(userId: string, input: IncomeEntryInput): Promise<IncomeEntry>;
  updateIncomeEntry(userId: string, id: string, input: IncomeEntryInput): Promise<IncomeEntry | undefined>;
  deleteIncomeEntry(userId: string, id: string): Promise<boolean>;
}

type Row = Record<string, unknown>;
function settings(row: Row): FinanceSettings {
  return {
    income: Number(row.income), avatar: String(row.avatar),
    categories: row.categories as FinanceSettings["categories"],
  };
}
function spending(row: Row): Spending {
  return {
    id: String(row.id), amount: Number(row.amount), description: String(row.description),
    category: String(row.category), date: String(row.date), time: String(row.time),
  };
}
function incomeEntry(row: Row): IncomeEntry {
  return { id: String(row.id), month: String(row.month), amount: Number(row.amount), description: String(row.description) };
}
const incomeEntryColumns = "id, to_char(month, 'YYYY-MM') AS month, amount, description";
const spendingColumns = "id, amount, description, category, to_char(date, 'YYYY-MM-DD') AS date, to_char(date + time, 'HH24:MI') AS time";

export function createFinanceStore(databaseUrl: string): FinanceStore {
  const sql = neon(databaseUrl);
  const query = async (text: string, params: unknown[] = []): Promise<Row[]> => await sql.query(text, params) as Row[];
  const ensure = (userId: string) => sql.query(
    "INSERT INTO finance_settings (user_id, categories) VALUES ($1, $2::jsonb) ON CONFLICT (user_id) DO NOTHING",
    [userId, JSON.stringify(defaultFinanceSettings().categories)],
  );
  const lock = (userId: string) => sql.query("SELECT user_id FROM finance_settings WHERE user_id = $1 FOR UPDATE", [userId]);
  const categoryAllowed = `EXISTS (SELECT 1 FROM finance_settings s, jsonb_array_elements(s.categories) c
    WHERE s.user_id = $1 AND c->>'id' = $5)`;
  function values(userId: string, id: string, input: SpendingInput): unknown[] {
    return [userId, id, input.amount, input.description, input.category, input.date, input.time];
  }
  return {
    async getSettings(userId) {
      const results = await sql.transaction([
        ensure(userId), sql.query("SELECT income, avatar, categories FROM finance_settings WHERE user_id = $1", [userId]),
      ], { isolationLevel: "ReadCommitted" });
      return settings(results[1][0]);
    },
    async updateSettings(userId, patch) {
      const results = await sql.transaction([
        ensure(userId), lock(userId),
        sql.query(`UPDATE finance_settings SET
          income = COALESCE($2::numeric, income),
          avatar = COALESCE($3::text, avatar), categories = COALESCE($4::jsonb, categories)
          WHERE user_id = $1 RETURNING income, avatar, categories`, [userId, patch.income ?? null,
          patch.avatar ?? null, patch.categories === undefined ? null : JSON.stringify(patch.categories)]),
      ], { isolationLevel: "ReadCommitted" });
      return settings(results[2][0]);
    },
    async listSpendings(userId, limit, cursor) {
      const rows = await query(`SELECT ${spendingColumns} FROM finance_spendings
        WHERE user_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id ASC LIMIT $3`, [userId, cursor ?? null, limit + 1]);
      const spendings = rows.slice(0, limit).map(spending);
      return { spendings, nextCursor: rows.length > limit ? spendings[spendings.length - 1].id : null };
    },
    async createSpending(userId, input) {
      // Lock in a separate statement: the following READ COMMITTED snapshot sees
      // settings committed while waiting. All settings/category writes take this lock.
      const results = await sql.transaction([
        ensure(userId), lock(userId),
        sql.query(`INSERT INTO finance_spendings (user_id, id, amount, description, category, date, time)
          SELECT $1, $2, $3, $4, $5, $6::date, $7::time WHERE ${categoryAllowed}
          RETURNING ${spendingColumns}`, values(userId, randomUUID(), input)),
      ], { isolationLevel: "ReadCommitted" });
      return results[2][0] ? spending(results[2][0]) : undefined;
    },
    async updateSpending(userId, id, input) {
      const results = await sql.transaction([
        ensure(userId), lock(userId),
        sql.query(`WITH updated AS (
          UPDATE finance_spendings SET amount = $3, description = $4, category = $5, date = $6::date, time = $7::time
          WHERE user_id = $1 AND id = $2 AND ${categoryAllowed} RETURNING ${spendingColumns}
        ) SELECT (SELECT row_to_json(updated) FROM updated) AS spending,
          EXISTS (SELECT 1 FROM finance_spendings WHERE user_id = $1 AND id = $2) AS found`, values(userId, id, input)),
      ], { isolationLevel: "ReadCommitted" });
      const row = results[2][0];
      if (row.spending) return spending(row.spending as Row);
      return row.found ? "invalid-category" : "not-found";
    },
    async listIncomeEntries(userId, limit, cursor) {
      const rows = await query(`SELECT ${incomeEntryColumns} FROM finance_income_entries
        WHERE user_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id ASC LIMIT $3`, [userId, cursor ?? null, limit + 1]);
      const incomeEntries = rows.slice(0, limit).map(incomeEntry);
      return { incomeEntries, nextCursor: rows.length > limit ? incomeEntries[incomeEntries.length - 1].id : null };
    },
    async createIncomeEntry(userId, input) {
      const rows = await query(`INSERT INTO finance_income_entries (user_id, id, month, amount, description)
        VALUES ($1, $2, $3::date, $4, $5) RETURNING ${incomeEntryColumns}`,
        [userId, randomUUID(), `${input.month}-01`, input.amount, input.description]);
      return incomeEntry(rows[0]);
    },
    async updateIncomeEntry(userId, id, input) {
      const rows = await query(`UPDATE finance_income_entries SET month = $3::date, amount = $4, description = $5
        WHERE user_id = $1 AND id = $2 RETURNING ${incomeEntryColumns}`,
        [userId, id, `${input.month}-01`, input.amount, input.description]);
      return rows[0] ? incomeEntry(rows[0]) : undefined;
    },
    async deleteIncomeEntry(userId, id) {
      const rows = await query("DELETE FROM finance_income_entries WHERE user_id = $1 AND id = $2 RETURNING id", [userId, id]);
      return rows.length > 0;
    },
    async deleteSpending(userId, id) {
      const results = await sql.transaction([
        ensure(userId), lock(userId),
        sql.query("DELETE FROM finance_spendings WHERE user_id = $1 AND id = $2 RETURNING id", [userId, id]),
      ], { isolationLevel: "ReadCommitted" });
      return results[2].length > 0;
    },
  };
}
