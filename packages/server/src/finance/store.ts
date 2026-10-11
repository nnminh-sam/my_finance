import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { defaultFinanceSettings, type FinanceSettings, type IncomeEntry, type IncomeEntryInput, type IncomeEntryPage, type RepeatRule, type RepeatRuleInput, type Spending, type SpendingInput, type SpendingPage } from "./model";
import { formatDateUtc, generateOccurrences, isRuleDueForSync, type RecurrenceState } from "./recurrence";

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
  listRepeatRules(userId: string): Promise<RepeatRule[]>;
  createRepeatRule(userId: string, input: RepeatRuleInput): Promise<{ repeatRule: RepeatRule; spendings: Spending[] } | undefined>;
  deleteRepeatRule(userId: string, id: string, deleteFuture?: boolean): Promise<boolean>;
  syncRepeatSpendings(userId: string, asOfDate?: string): Promise<number>;
}

type Row = Record<string, unknown>;
function settings(row: Row): FinanceSettings {
  return {
    income: Number(row.income), avatar: String(row.avatar),
    categories: row.categories as FinanceSettings["categories"],
  };
}
function spending(row: Row): Spending {
  const result: Spending = {
    id: String(row.id), amount: Number(row.amount), description: String(row.description),
    category: String(row.category), date: String(row.date), time: String(row.time),
  };
  if (row.repeat_rule_id) result.repeatRuleId = String(row.repeat_rule_id);
  return result;
}
function incomeEntry(row: Row): IncomeEntry {
  return { id: String(row.id), month: String(row.month), amount: Number(row.amount), description: String(row.description) };
}
function repeatRule(row: Row): RepeatRule {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    amount: Number(row.amount),
    description: String(row.description),
    category: String(row.category),
    startDate: String(row.start_date),
    time: String(row.time),
    frequency: String(row.frequency) as RepeatRule["frequency"],
    interval: Number(row.interval),
    daysOfWeek: Array.isArray(row.days_of_week) ? row.days_of_week as number[] : [],
    endType: String(row.end_type) as RepeatRule["endType"],
    totalOccurrences: row.total_occurrences ? Number(row.total_occurrences) : undefined,
    endDate: row.end_date ? String(row.end_date) : undefined,
    occurrencesCreated: Number(row.occurrences_created),
    lastGeneratedDate: row.last_generated_date ? String(row.last_generated_date) : null,
    createdAt: String(row.created_at),
  };
}

const incomeEntryColumns = "id, to_char(month, 'YYYY-MM') AS month, amount, description";
const spendingColumns = "id, amount, description, category, to_char(date, 'YYYY-MM-DD') AS date, to_char(date + time, 'HH24:MI') AS time, repeat_rule_id::text AS repeat_rule_id";
const repeatRuleColumns = `id, user_id, amount, description, category,
  to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(start_date + time, 'HH24:MI') AS time,
  frequency, interval, days_of_week, end_type, total_occurrences,
  to_char(end_date, 'YYYY-MM-DD') AS end_date,
  occurrences_created,
  to_char(last_generated_date, 'YYYY-MM-DD') AS last_generated_date,
  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`;

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
    return [userId, id, input.amount, input.description, input.category, input.date, input.time, input.repeatRuleId ?? null];
  }

  const store: FinanceStore = {
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
      await store.syncRepeatSpendings(userId).catch(() => 0);
      const rows = await query(`SELECT ${spendingColumns} FROM finance_spendings
        WHERE user_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id ASC LIMIT $3`, [userId, cursor ?? null, limit + 1]);
      const spendings = rows.slice(0, limit).map(spending);
      return { spendings, nextCursor: rows.length > limit ? spendings[spendings.length - 1].id : null };
    },
    async createSpending(userId, input) {
      const results = await sql.transaction([
        ensure(userId), lock(userId),
        sql.query(`INSERT INTO finance_spendings (user_id, id, amount, description, category, date, time, repeat_rule_id)
          SELECT $1, $2, $3, $4, $5, $6::date, $7::time, $8::uuid WHERE ${categoryAllowed}
          RETURNING ${spendingColumns}`, values(userId, randomUUID(), input)),
      ], { isolationLevel: "ReadCommitted" });
      return results[2][0] ? spending(results[2][0]) : undefined;
    },
    async updateSpending(userId, id, input) {
      const results = await sql.transaction([
        ensure(userId), lock(userId),
        sql.query(`WITH updated AS (
          UPDATE finance_spendings SET amount = $3, description = $4, category = $5, date = $6::date, time = $7::time, repeat_rule_id = $8::uuid
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
    async listRepeatRules(userId) {
      await store.syncRepeatSpendings(userId).catch(() => 0);
      const rows = await query(`SELECT ${repeatRuleColumns} FROM finance_repeat_rules WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
      return rows.map(repeatRule);
    },
    async createRepeatRule(userId, input) {
      const results = await sql.transaction([
        ensure(userId), lock(userId),
        sql.query(`SELECT EXISTS (SELECT 1 FROM finance_settings s, jsonb_array_elements(s.categories) c
          WHERE s.user_id = $1 AND c->>'id' = $2) AS allowed`, [userId, input.category]),
      ], { isolationLevel: "ReadCommitted" });
      if (!results[2][0]?.allowed) return undefined;

      const ruleId = randomUUID();
      const ruleState: RecurrenceState = {
        startDate: input.startDate,
        frequency: input.frequency,
        interval: input.interval ?? 1,
        daysOfWeek: input.daysOfWeek,
        endType: input.endType,
        totalOccurrences: input.totalOccurrences,
        endDate: input.endDate,
        occurrencesCreated: 0,
        lastGeneratedDate: null,
      };
      const batch = generateOccurrences(ruleState, 100);

      const ruleInsert = sql.query(
        `INSERT INTO finance_repeat_rules (
          id, user_id, amount, description, category, start_date, time,
          frequency, interval, days_of_week, end_type, total_occurrences, end_date,
          occurrences_created, last_generated_date
        ) VALUES ($1, $2, $3, $4, $5, $6::date, $7::time, $8, $9, $10::jsonb, $11, $12, $13::date, $14, $15::date)
        RETURNING ${repeatRuleColumns}`,
        [
          ruleId, userId, input.amount, input.description, input.category,
          input.startDate, input.time, input.frequency, input.interval ?? 1,
          JSON.stringify(input.daysOfWeek ?? []), input.endType,
          input.totalOccurrences ?? null, input.endDate ?? null,
          batch.newOccurrencesCreated, batch.newLastGeneratedDate ?? null,
        ]
      );

      const createdSpendings: Spending[] = [];
      if (batch.dates.length > 0) {
        const placeholders: string[] = [];
        const params: unknown[] = [userId, ruleId, input.amount, input.description, input.category, input.time];
        batch.dates.forEach((dateStr, idx) => {
          const spendingId = randomUUID();
          const idIdx = 7 + idx * 2;
          const dateIdx = 8 + idx * 2;
          params.push(spendingId, dateStr);
          placeholders.push(`($1, $${idIdx}, $3, $4, $5, $${dateIdx}::date, $6::time, $2)`);
        });
        const spendingsInsert = sql.query(
          `INSERT INTO finance_spendings (user_id, id, amount, description, category, date, time, repeat_rule_id)
           VALUES ${placeholders.join(", ")}
           RETURNING ${spendingColumns}`,
          params
        );
        const txResults = await sql.transaction([ruleInsert, spendingsInsert], { isolationLevel: "ReadCommitted" });
        const savedRule = repeatRule(txResults[0][0]);
        for (const row of txResults[1]) {
          createdSpendings.push(spending(row));
        }
        return { repeatRule: savedRule, spendings: createdSpendings };
      } else {
        const txResults = await sql.transaction([ruleInsert], { isolationLevel: "ReadCommitted" });
        return { repeatRule: repeatRule(txResults[0][0]), spendings: [] };
      }
    },
    async deleteRepeatRule(userId, id, deleteFuture = true) {
      const statements: any[] = [];
      if (deleteFuture) {
        const today = formatDateUtc(new Date());
        statements.push(
          sql.query(
            "DELETE FROM finance_spendings WHERE user_id = $1 AND repeat_rule_id = $2 AND date >= $3::date",
            [userId, id, today]
          )
        );
      }
      statements.push(
        sql.query("DELETE FROM finance_repeat_rules WHERE user_id = $1 AND id = $2 RETURNING id", [userId, id])
      );
      const results = await sql.transaction(statements, { isolationLevel: "ReadCommitted" });
      const deleteResult = results[results.length - 1];
      return deleteResult.length > 0;
    },
    async syncRepeatSpendings(userId, asOfDate = formatDateUtc(new Date())) {
      const rows = await query(`SELECT ${repeatRuleColumns} FROM finance_repeat_rules WHERE user_id = $1`, [userId]);
      const rules = rows.map(repeatRule);
      let totalCreated = 0;

      for (const rule of rules) {
        const state: RecurrenceState = {
          startDate: rule.startDate,
          frequency: rule.frequency,
          interval: rule.interval,
          daysOfWeek: rule.daysOfWeek,
          endType: rule.endType,
          totalOccurrences: rule.totalOccurrences,
          endDate: rule.endDate,
          occurrencesCreated: rule.occurrencesCreated,
          lastGeneratedDate: rule.lastGeneratedDate,
        };

        if (!isRuleDueForSync(state, asOfDate)) continue;

        const batch = generateOccurrences(state, 100);
        if (batch.dates.length === 0) continue;

        const updateRuleQuery = sql.query(
          `UPDATE finance_repeat_rules SET occurrences_created = $3, last_generated_date = $4::date
           WHERE user_id = $1 AND id = $2`,
          [userId, rule.id, batch.newOccurrencesCreated, batch.newLastGeneratedDate]
        );

        const placeholders: string[] = [];
        const params: unknown[] = [userId, rule.id, rule.amount, rule.description, rule.category, rule.time];
        batch.dates.forEach((dateStr, idx) => {
          const spendingId = randomUUID();
          const idIdx = 7 + idx * 2;
          const dateIdx = 8 + idx * 2;
          params.push(spendingId, dateStr);
          placeholders.push(`($1, $${idIdx}, $3, $4, $5, $${dateIdx}::date, $6::time, $2)`);
        });

        const spendingsInsert = sql.query(
          `INSERT INTO finance_spendings (user_id, id, amount, description, category, date, time, repeat_rule_id)
           VALUES ${placeholders.join(", ")}`,
          params
        );

        await sql.transaction([updateRuleQuery, spendingsInsert], { isolationLevel: "ReadCommitted" });
        totalCreated += batch.dates.length;
      }

      return totalCreated;
    },
  };

  return store;
}

