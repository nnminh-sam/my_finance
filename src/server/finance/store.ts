import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { addDays, dueOccurrences, isPlanDate, localNowStamp, planOccurrences, stampOf, type PlanException } from "../../lib/plans";
import { SHOW_BY } from "../../lib/periods";
import { defaultFinanceSettings, type FinanceSettings, type Income, type IncomeInput, type IncomePage, type Plan, type PlanExceptionInput, type PlanInput, type RepeatRule, type RepeatRuleInput, type SettingsPatch, type Spending, type SpendingInput, type SpendingPage } from "./model";
import { formatDateUtc, generateOccurrences, isRuleDueForSync, type RecurrenceState } from "./recurrence";

export interface FinanceStore {
  getSettings(userId: string): Promise<FinanceSettings>;
  /** "invalid-budget-period": the paycheck income is missing, not the user's, or not weekly, semimonthly or monthly. Nothing is written. */
  updateSettings(userId: string, patch: SettingsPatch): Promise<FinanceSettings | "invalid-budget-period">;
  /** Spendings made from a plan whose occurrence date is in [fromDate, toDate], whatever date they were paid on (early "Done now"). */
  listPlanSpendings(userId: string, fromDate: string, toDate: string): Promise<Spending[]>;
  listSpendings(userId: string, limit: number, cursor?: string, startDate?: string, endDate?: string): Promise<SpendingPage>;
  createSpending(userId: string, input: SpendingInput): Promise<Spending | undefined>;
  updateSpending(userId: string, id: string, input: SpendingInput): Promise<Spending | "not-found" | "invalid-category">;
  deleteSpending(userId: string, id: string): Promise<boolean>;
  listIncomes(userId: string, limit: number, cursor?: string): Promise<IncomePage>;
  createIncome(userId: string, input: IncomeInput): Promise<Income>;
  /** "paycheck-in-use": the income is the paycheck of the budget period and the new frequency cannot be one. */
  updateIncome(userId: string, id: string, input: IncomeInput): Promise<Income | undefined | "paycheck-in-use">;
  /** Also resets the budget period to calendar when this income was its paycheck. */
  deleteIncome(userId: string, id: string): Promise<boolean>;
  listRepeatRules(userId: string): Promise<RepeatRule[]>;
  createRepeatRule(userId: string, input: RepeatRuleInput): Promise<{ repeatRule: RepeatRule; spendings: Spending[] } | undefined>;
  deleteRepeatRule(userId: string, id: string, deleteFuture?: boolean): Promise<boolean>;
  syncRepeatSpendings(userId: string, asOfDate?: string): Promise<number>;
  listPlans(userId: string): Promise<Plan[]>;
  createPlan(userId: string, input: PlanInput): Promise<Plan | "invalid-category">;
  updatePlan(userId: string, id: string, input: PlanInput): Promise<Plan | "not-found" | "invalid-category">;
  /** "This and future": ends the plan the day before `input.startDate` and starts a new plan from it. */
  splitPlan(userId: string, id: string, input: PlanInput): Promise<{ ended: Plan; created: Plan } | "not-found" | "invalid-category" | "invalid-date">;
  deletePlan(userId: string, id: string): Promise<boolean>;
  setPlanException(userId: string, id: string, date: string, input: PlanExceptionInput): Promise<Plan | "not-found" | "invalid-date">;
  deletePlanException(userId: string, id: string, date: string): Promise<Plan | "not-found">;
  /** "Done now": records an upcoming occurrence as a real spending right away, so it is never counted twice. */
  completePlanOccurrence(userId: string, id: string, date: string, at?: Date): Promise<Spending | "not-found" | "invalid-date">;
  /** Turns every plan occurrence whose local date+time has passed into a real spending. */
  materializePlans(userId: string, at?: Date): Promise<number>;
}

type Row = Record<string, unknown>;
function settings(row: Row): FinanceSettings {
  return {
    avatar: String(row.avatar),
    categories: row.categories as FinanceSettings["categories"],
    timezone: String(row.timezone),
    budgetPeriod: {
      mode: String(row.budget_period_mode) as FinanceSettings["budgetPeriod"]["mode"],
      startDay: Number(row.budget_period_start_day),
      paycheckIncomeId: row.paycheck_income_id ? String(row.paycheck_income_id) : null,
    },
    // A value outside the allow-list (an unexpected row) reads as the default.
    showBy: (SHOW_BY as readonly string[]).includes(String(row.show_by)) ? String(row.show_by) as FinanceSettings["showBy"] : "calendar_month",
  };
}
function spending(row: Row): Spending {
  const result: Spending = {
    id: String(row.id), amount: Number(row.amount), description: String(row.description),
    category: String(row.category), date: String(row.date), time: String(row.time),
  };
  if (row.repeat_rule_id) result.repeatRuleId = String(row.repeat_rule_id);
  if (row.plan_id) result.planId = String(row.plan_id);
  if (row.plan_date) result.planDate = String(row.plan_date);
  return result;
}
function plan(row: Row): Plan {
  const exceptions = (Array.isArray(row.exceptions) ? row.exceptions : []) as Row[];
  return {
    id: String(row.id), amount: Number(row.amount), description: String(row.description),
    category: String(row.category), time: String(row.time), startDate: String(row.start_date),
    frequency: String(row.frequency) as Plan["frequency"], interval: Number(row.interval),
    daysOfWeek: Array.isArray(row.days_of_week) ? row.days_of_week as number[] : [],
    endDate: row.end_date ? String(row.end_date) : null,
    sure: row.sure === true,
    materializedThrough: String(row.materialized_through), createdAt: String(row.created_at),
    exceptions: exceptions.map((item): PlanException => ({
      date: String(item.date), kind: item.kind === "skip" ? "skip" : "override",
      amount: item.amount === null || item.amount === undefined ? null : Number(item.amount),
      description: item.description === null || item.description === undefined ? null : String(item.description),
    })),
  };
}
// Schedule options that equal their default are left out, so incomes that do not use them look as before.
function income(row: Row): Income {
  const result: Income = {
    id: String(row.id), source: String(row.source), name: String(row.name), amount: Number(row.amount),
    frequency: String(row.frequency) as Income["frequency"], startDate: String(row.start_date),
    endDate: row.end_date ? String(row.end_date) : null,
  };
  const interval = Number(row.interval);
  if (interval === 2 || interval === 4) result.interval = interval;
  if (result.frequency === "semimonthly") result.semimonthlyDays = [Number(row.semimonthly_day_1), Number(row.semimonthly_day_2)];
  if (row.weekend_shift === true) result.weekendShift = true;
  return result;
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

const incomeColumns = "id, source, name, amount, frequency, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, interval, semimonthly_day_1, semimonthly_day_2, weekend_shift";
const settingsColumns = "avatar, categories, timezone, budget_period_mode, budget_period_start_day, paycheck_income_id::text AS paycheck_income_id, show_by";
// Income columns shared by the INSERT and UPDATE parameter lists ($9..$12).
function scheduleValues(input: IncomeInput): unknown[] {
  return [input.interval ?? 1, input.semimonthlyDays?.[0] ?? null, input.semimonthlyDays?.[1] ?? null, input.weekendShift === true];
}
const spendingColumns = "id, amount, description, category, to_char(date, 'YYYY-MM-DD') AS date, to_char(date + time, 'HH24:MI') AS time, repeat_rule_id::text AS repeat_rule_id, plan_id::text AS plan_id, to_char(plan_date, 'YYYY-MM-DD') AS plan_date";
// Selected from an alias/CTE named `p`; exceptions already materialized are omitted.
const planColumns = `p.id, p.amount, p.description, p.category, to_char(p.start_date + p.time, 'HH24:MI') AS time,
  to_char(p.start_date, 'YYYY-MM-DD') AS start_date, p.frequency, p.interval, p.days_of_week, p.sure,
  to_char(p.end_date, 'YYYY-MM-DD') AS end_date,
  to_char(p.materialized_through, 'YYYY-MM-DD"T"HH24:MI') AS materialized_through,
  to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('date', to_char(e.date, 'YYYY-MM-DD'), 'kind', e.kind,
      'amount', e.amount, 'description', e.description) ORDER BY e.date)
    FROM finance_plan_exceptions e WHERE e.plan_id = p.id AND e.date >= p.materialized_through::date), '[]'::jsonb) AS exceptions`;
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
        ensure(userId), sql.query(`SELECT ${settingsColumns} FROM finance_settings WHERE user_id = $1`, [userId]),
      ], { isolationLevel: "ReadCommitted" });
      return settings(results[1][0]);
    },
    async updateSettings(userId, patch) {
      const period = patch.budgetPeriod;
      const setsPaycheck = period !== undefined && Object.hasOwn(period, "paycheckIncomeId");
      // Only a patch that names budgetPeriod is checked, so avatar, categories and timezone saves never fail on it.
      // The resulting mode and id must agree: a mode other than paycheck clears the id, paycheck mode needs one
      // of the user's own weekly, semimonthly or monthly incomes.
      const mode = "COALESCE($5::text, budget_period_mode)";
      const nextId = `(CASE WHEN NOT $9::boolean THEN paycheck_income_id WHEN ${mode} <> 'paycheck' THEN NULL
        WHEN $7::boolean THEN $8::uuid ELSE paycheck_income_id END)`;
      const results = await sql.transaction([
        ensure(userId), lock(userId),
        sql.query(`UPDATE finance_settings SET
          avatar = COALESCE($2::text, avatar), categories = COALESCE($3::jsonb, categories), timezone = COALESCE($4::text, timezone),
          budget_period_mode = ${mode},
          budget_period_start_day = COALESCE($6::integer, budget_period_start_day),
          show_by = COALESCE($10::text, show_by),
          paycheck_income_id = ${nextId}
          WHERE user_id = $1 AND (
            NOT $9::boolean
            OR (${nextId} IS NULL AND ${mode} <> 'paycheck')
            OR EXISTS (SELECT 1 FROM finance_incomes i WHERE i.user_id = $1
              AND i.id = ${nextId}
              AND i.frequency IN ('weekly', 'semimonthly', 'monthly')))
          RETURNING ${settingsColumns}`, [userId,
          patch.avatar ?? null, patch.categories === undefined ? null : JSON.stringify(patch.categories), patch.timezone ?? null,
          period?.mode ?? null, period?.startDay ?? null, setsPaycheck, period?.paycheckIncomeId ?? null, period !== undefined, patch.showBy ?? null]),
      ], { isolationLevel: "ReadCommitted" });
      return results[2][0] ? settings(results[2][0]) : "invalid-budget-period";
    },
    async listPlanSpendings(userId, fromDate, toDate) {
      const rows = await query(`SELECT ${spendingColumns} FROM finance_spendings
        WHERE user_id = $1 AND plan_id IS NOT NULL AND plan_date BETWEEN $2::date AND $3::date ORDER BY id ASC LIMIT 10000`, [userId, fromDate, toDate]);
      return rows.map(spending);
    },
    async listSpendings(userId, limit, cursor, startDate, endDate) {
      await store.syncRepeatSpendings(userId).catch(() => 0);
      await store.materializePlans(userId).catch(() => 0);
      const rows = !startDate && !endDate
        ? await query(`SELECT ${spendingColumns} FROM finance_spendings
            WHERE user_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id ASC LIMIT $3`, [userId, cursor ?? null, limit + 1])
        : await query(`SELECT ${spendingColumns} FROM finance_spendings
            WHERE user_id = $1
              AND ($2::uuid IS NULL OR id > $2::uuid)
              AND ($4::date IS NULL OR date >= $4::date)
              AND ($5::date IS NULL OR date <= $5::date)
            ORDER BY id ASC LIMIT $3`, [userId, cursor ?? null, limit + 1, startDate ?? null, endDate ?? null]);
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
    async listIncomes(userId, limit, cursor) {
      const rows = await query(`SELECT ${incomeColumns} FROM finance_incomes
        WHERE user_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id ASC LIMIT $3`, [userId, cursor ?? null, limit + 1]);
      const incomes = rows.slice(0, limit).map(income);
      return { incomes, nextCursor: rows.length > limit ? incomes[incomes.length - 1].id : null };
    },
    async createIncome(userId, input) {
      const rows = await query(`INSERT INTO finance_incomes (user_id, id, source, name, amount, frequency, start_date, end_date,
          interval, semimonthly_day_1, semimonthly_day_2, weekend_shift)
        VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12) RETURNING ${incomeColumns}`,
        [userId, randomUUID(), input.source, input.name, input.amount, input.frequency, input.startDate, input.endDate, ...scheduleValues(input)]);
      return income(rows[0]);
    },
    async updateIncome(userId, id, input) {
      // While the budget period is in paycheck mode, its paycheck income cannot become a frequency that is not usable as one.
      const rows = await query(`WITH updated AS (
          UPDATE finance_incomes SET source = $3, name = $4, amount = $5, frequency = $6,
            start_date = $7::date, end_date = $8::date,
            interval = $9, semimonthly_day_1 = $10, semimonthly_day_2 = $11, weekend_shift = $12
          WHERE user_id = $1 AND id = $2
            AND NOT (EXISTS (SELECT 1 FROM finance_settings s WHERE s.user_id = $1 AND s.paycheck_income_id = $2 AND s.budget_period_mode = 'paycheck')
              AND $6 NOT IN ('weekly', 'semimonthly', 'monthly'))
          RETURNING ${incomeColumns}
        ) SELECT (SELECT row_to_json(updated) FROM updated) AS income,
          EXISTS (SELECT 1 FROM finance_incomes WHERE user_id = $1 AND id = $2) AS found`,
        [userId, id, input.source, input.name, input.amount, input.frequency, input.startDate, input.endDate, ...scheduleValues(input)]);
      if (rows[0].income) return income(rows[0].income as Row);
      return rows[0].found ? "paycheck-in-use" : undefined;
    },
    async deleteIncome(userId, id) {
      // Only updates an existing settings row (and only in paycheck mode), so deleting an income never creates or locks one.
      const results = await sql.transaction([
        sql.query(`UPDATE finance_settings SET budget_period_mode = 'calendar', paycheck_income_id = NULL
          WHERE user_id = $1 AND paycheck_income_id = $2 AND budget_period_mode = 'paycheck'`, [userId, id]),
        sql.query("DELETE FROM finance_incomes WHERE user_id = $1 AND id = $2 RETURNING id", [userId, id]),
      ], { isolationLevel: "ReadCommitted" });
      return results[1].length > 0;
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
      const rows = await query(`SELECT ${repeatRuleColumns} FROM finance_repeat_rules WHERE user_id = $1 AND migrated_at IS NULL ORDER BY created_at DESC`, [userId]);
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
      // Rules converted to plans by 008_plan_commitments.sql no longer write rows ahead.
      const rows = await query(`SELECT ${repeatRuleColumns} FROM finance_repeat_rules WHERE user_id = $1 AND migrated_at IS NULL`, [userId]);
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
    async listPlans(userId) {
      await store.materializePlans(userId).catch(() => 0);
      const rows = await query(`SELECT ${planColumns} FROM finance_plans p WHERE p.user_id = $1 ORDER BY p.created_at ASC, p.id ASC`, [userId]);
      return rows.map(plan);
    },
    async createPlan(userId, input) {
      // The watermark starts at the user's local "now": a plan never back-fills past dates.
      const results = await sql.transaction([
        ensure(userId), lock(userId),
        sql.query(`WITH p AS (
          INSERT INTO finance_plans (id, user_id, amount, description, category, time, start_date, frequency, interval, days_of_week, end_date, sure, materialized_through)
          SELECT $2, $1, $3, $4, $5, $6::time, $7::date, $8, $9, $10::jsonb, $11::date, $12, date_trunc('minute', now() AT TIME ZONE s.timezone)
          FROM finance_settings s
          WHERE s.user_id = $1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.categories) c WHERE c->>'id' = $5)
          RETURNING *
        ) SELECT ${planColumns} FROM p`, [userId, randomUUID(), ...planValues(input)]),
      ], { isolationLevel: "ReadCommitted" });
      return results[2][0] ? plan(results[2][0]) : "invalid-category";
    },
    async updatePlan(userId, id, input) {
      const results = await sql.transaction([
        ensure(userId), lock(userId),
        sql.query(`UPDATE finance_plans p SET amount = $3, description = $4, category = $5, time = $6::time, start_date = $7::date,
            frequency = $8, interval = $9, days_of_week = $10::jsonb, end_date = $11::date, sure = $12
          WHERE p.user_id = $1 AND p.id = $2 AND EXISTS (SELECT 1 FROM finance_settings s, jsonb_array_elements(s.categories) c
            WHERE s.user_id = $1 AND c->>'id' = $5)
          RETURNING p.id`, [userId, id, ...planValues(input)]),
        sql.query(`SELECT ${planColumns} FROM finance_plans p WHERE p.user_id = $1 AND p.id = $2`, [userId, id]),
      ], { isolationLevel: "ReadCommitted" });
      if (results[2].length) return plan(results[3][0]);
      return results[3].length ? "invalid-category" : "not-found";
    },
    async splitPlan(userId, id, input) {
      const existing = await query(`SELECT ${planColumns} FROM finance_plans p WHERE p.user_id = $1 AND p.id = $2`, [userId, id]);
      if (!existing.length) return "not-found";
      const old = plan(existing[0]);
      if (old.frequency === "once" || input.startDate <= old.startDate) return "invalid-date";
      const newId = randomUUID();
      const results = await sql.transaction([
        ensure(userId), lock(userId),
        sql.query(`INSERT INTO finance_plans (id, user_id, amount, description, category, time, start_date, frequency, interval, days_of_week, end_date, sure, materialized_through)
          SELECT $2, $1, $3, $4, $5, $6::time, $7::date, $8, $9, $10::jsonb, $11::date, $12, p.materialized_through
          FROM finance_plans p
          WHERE p.user_id = $1 AND p.id = $13 AND EXISTS (SELECT 1 FROM finance_settings s, jsonb_array_elements(s.categories) c
            WHERE s.user_id = $1 AND c->>'id' = $5)
          RETURNING id`, [userId, newId, ...planValues(input), id]),
        sql.query(`UPDATE finance_plans SET end_date = LEAST(COALESCE(end_date, $3::date), $3::date)
          WHERE user_id = $1 AND id = $2 AND EXISTS (SELECT 1 FROM finance_plans WHERE id = $4)`,
          [userId, id, addDays(input.startDate, -1), newId]),
        sql.query(`UPDATE finance_plan_exceptions SET plan_id = $3
          WHERE plan_id = $2 AND date >= $4::date AND EXISTS (SELECT 1 FROM finance_plans WHERE id = $3 AND user_id = $1)`,
          [userId, id, newId, input.startDate]),
        sql.query(`SELECT ${planColumns} FROM finance_plans p WHERE p.user_id = $1 AND p.id = ANY($2::uuid[])`, [userId, [id, newId]]),
      ], { isolationLevel: "ReadCommitted" });
      if (!results[2].length) return "invalid-category";
      const rows = results[5].map(plan);
      const ended = rows.find(row => row.id === id);
      const created = rows.find(row => row.id === newId);
      return ended && created ? { ended, created } : "not-found";
    },
    async deletePlan(userId, id) {
      const rows = await query("DELETE FROM finance_plans WHERE user_id = $1 AND id = $2 RETURNING id", [userId, id]);
      return rows.length > 0;
    },
    async setPlanException(userId, id, date, input) {
      const existing = await query(`SELECT ${planColumns} FROM finance_plans p WHERE p.user_id = $1 AND p.id = $2`, [userId, id]);
      if (!existing.length) return "not-found";
      const current = plan(existing[0]);
      // Only a future (not yet real) occurrence of this plan can be skipped or changed.
      if (!isPlanDate(current, date) || stampOf(date, current.time) <= current.materializedThrough) return "invalid-date";
      const results = await sql.transaction([
        sql.query(`INSERT INTO finance_plan_exceptions (plan_id, date, kind, amount, description)
          SELECT id, $3::date, $4, $5, $6 FROM finance_plans WHERE user_id = $1 AND id = $2
          ON CONFLICT (plan_id, date) DO UPDATE SET kind = EXCLUDED.kind, amount = EXCLUDED.amount, description = EXCLUDED.description`,
          [userId, id, date, input.kind, input.amount, input.description]),
        sql.query(`SELECT ${planColumns} FROM finance_plans p WHERE p.user_id = $1 AND p.id = $2`, [userId, id]),
      ], { isolationLevel: "ReadCommitted" });
      return results[1][0] ? plan(results[1][0]) : "not-found";
    },
    async deletePlanException(userId, id, date) {
      const results = await sql.transaction([
        sql.query(`DELETE FROM finance_plan_exceptions e USING finance_plans p
          WHERE e.plan_id = p.id AND p.user_id = $1 AND p.id = $2 AND e.date = $3::date`, [userId, id, date]),
        sql.query(`SELECT ${planColumns} FROM finance_plans p WHERE p.user_id = $1 AND p.id = $2`, [userId, id]),
      ], { isolationLevel: "ReadCommitted" });
      return results[1][0] ? plan(results[1][0]) : "not-found";
    },
    async completePlanOccurrence(userId, id, date, at = new Date()) {
      const rows = await query(`SELECT s.timezone, ${planColumns}
        FROM finance_plans p JOIN finance_settings s ON s.user_id = p.user_id WHERE p.user_id = $1 AND p.id = $2`, [userId, id]);
      if (!rows.length) return "not-found";
      const current = plan(rows[0]);
      const occurrence = planOccurrences(current, date, date)[0];
      if (!occurrence || stampOf(date, current.time) <= current.materializedThrough) return "invalid-date";
      // Recorded now: a past occurrence keeps its own date and time, a future one lands on "now".
      const now = localNowStamp(String(rows[0].timezone), at);
      const [day, time] = stampOf(date, current.time) <= now ? [date, current.time] : [now.slice(0, 10), now.slice(11)];
      const inserted = await query(`INSERT INTO finance_spendings (user_id, id, amount, description, category, date, time, plan_id, plan_date)
        VALUES ($1, $2, $3, $4, $5, $6::date, $7::time, $8, $9::date)
        ON CONFLICT (plan_id, plan_date) DO NOTHING
        RETURNING ${spendingColumns}`,
        [userId, randomUUID(), occurrence.amount, occurrence.description, occurrence.category, day, time, id, date]);
      return inserted[0] ? spending(inserted[0]) : "invalid-date";
    },
    async materializePlans(userId, at = new Date()) {
      const rows = await query(`SELECT s.timezone, ${planColumns}
        FROM finance_plans p JOIN finance_settings s ON s.user_id = p.user_id WHERE p.user_id = $1`, [userId]);
      if (!rows.length) return 0;
      const now = localNowStamp(String(rows[0].timezone), at);
      const due = rows.map(plan).flatMap(item => dueOccurrences(item, item.materializedThrough, now));
      if (!due.length) return 0;
      const results = await sql.transaction([
        // The watermark check stops a stale worker from re-creating an occurrence the user
        // already deleted; the unique (plan_id, plan_date) index absorbs concurrent workers.
        sql.query(`INSERT INTO finance_spendings (user_id, id, amount, description, category, date, time, plan_id, plan_date)
          SELECT $1, u.id, u.amount, u.description, u.category, u.date, u.time, u.plan_id, u.date
          FROM unnest($2::uuid[], $3::numeric[], $4::text[], $5::text[], $6::date[], $7::time[], $8::uuid[])
            AS u(id, amount, description, category, date, time, plan_id)
          WHERE EXISTS (SELECT 1 FROM finance_plans p WHERE p.id = u.plan_id AND p.user_id = $1 AND p.materialized_through < u.date + u.time)
          ON CONFLICT (plan_id, plan_date) DO NOTHING
          RETURNING id`, [
          userId, due.map(() => randomUUID()), due.map(item => item.amount), due.map(item => item.description),
          due.map(item => item.category), due.map(item => item.date), due.map(item => item.time), due.map(item => item.planId),
        ]),
        sql.query(`UPDATE finance_plans SET materialized_through = GREATEST(materialized_through, $2::timestamp)
          WHERE user_id = $1 AND id = ANY($3::uuid[])`, [userId, now.replace("T", " "), [...new Set(due.map(item => item.planId))]]),
        sql.query(`DELETE FROM finance_plan_exceptions e USING finance_plans p
          WHERE e.plan_id = p.id AND p.user_id = $1 AND e.date < $2::date`, [userId, now.slice(0, 10)]),
      ], { isolationLevel: "ReadCommitted" });
      return results[0].length;
    },
  };

  return store;
}

function planValues(input: PlanInput): unknown[] {
  return [input.amount, input.description, input.category, input.time, input.startDate, input.frequency,
    input.interval, JSON.stringify(input.daysOfWeek), input.endDate, input.sure];
}

