import { randomUUID } from "node:crypto";
import { dueIncomePaydays, INCOME_RECORD_TIME } from "../../src/lib/income";
import { localNowStamp } from "../../src/lib/plans";
import type { FinanceSettings, Income, Spending, Transaction, TransactionInput, TransactionKind } from "../../src/server/finance/model";

interface Host {
  getSettings(userId: string): Promise<FinanceSettings>;
  rows(userId: string): Map<string, Spending>;
  incomeRows(userId: string): Map<string, Income>;
  materializePlans(userId: string): Promise<number>;
}

function expense(row: Spending): Transaction {
  const result: Transaction = { id: row.id, kind: "expense", amount: row.amount, description: row.description, category: row.category, date: row.date, time: row.time };
  if (row.planId) result.planId = row.planId;
  if (row.planDate) result.planDate = row.planDate;
  return result;
}

/**
 * In-memory twin of the Neon ledger methods (one table, kind expense or income), shared by the HTTP and MCP test fakes.
 * Expense rows live in the host's spendings map; income rows written from income schedules live here.
 */
export class MemoryLedger {
  income = new Map<string, Map<string, Transaction>>();
  /** materialized_through per income id; missing = null (nothing written yet). */
  watermarks = new Map<string, string>();

  constructor(private host: Host, private clock: () => Date) {}

  incomeRecords(userId: string) {
    if (!this.income.has(userId)) this.income.set(userId, new Map());
    return this.income.get(userId)!;
  }

  async materializeIncomes(userId: string) {
    const schedules = [...this.host.incomeRows(userId).values()];
    if (!schedules.length) return 0;
    const now = localNowStamp((await this.host.getSettings(userId)).timezone, this.clock());
    const records = this.incomeRecords(userId);
    let created = 0;
    for (const schedule of schedules) {
      const after = this.watermarks.get(schedule.id) ?? null;
      if (after !== null && after >= now) continue;
      for (const { nominal, paid } of dueIncomePaydays(schedule, after, now)) {
        if ([...records.values()].some(row => row.incomeId === schedule.id && row.incomeDate === nominal)) continue;
        const row: Transaction = {
          id: randomUUID(), kind: "income", amount: schedule.amount, description: schedule.name, category: schedule.source,
          date: paid, time: INCOME_RECORD_TIME, incomeId: schedule.id, incomeDate: nominal,
        };
        records.set(row.id, row);
        created++;
      }
      this.watermarks.set(schedule.id, after !== null && after > now ? after : now);
    }
    return created;
  }

  async listTransactions(userId: string, limit: number, cursor?: string, startDate?: string, endDate?: string, kind?: TransactionKind) {
    await this.host.materializePlans(userId);
    await this.materializeIncomes(userId);
    const all = [...[...this.host.rows(userId).values()].map(expense), ...this.incomeRecords(userId).values()];
    const rows = all
      .filter(row => (!cursor || row.id > cursor) && (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate) && (!kind || row.kind === kind))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const transactions = rows.slice(0, limit);
    return { transactions: structuredClone(transactions), nextCursor: rows.length > limit ? transactions[transactions.length - 1].id : null };
  }

  async updateTransaction(userId: string, id: string, input: TransactionInput) {
    const incomeRow = this.incomeRecords(userId).get(id);
    if (incomeRow) {
      Object.assign(incomeRow, input);
      return structuredClone(incomeRow);
    }
    const spending = this.host.rows(userId).get(id);
    if (!spending) return "not-found" as const;
    if (!(await this.host.getSettings(userId)).categories.some(item => item.id === input.category)) return "invalid-category" as const;
    Object.assign(spending, input);
    return expense(spending);
  }

  async deleteTransaction(userId: string, id: string) {
    return this.incomeRecords(userId).delete(id) || this.host.rows(userId).delete(id);
  }

  /** Call after an income schedule changes: a one-time income is rewritten, a recurring one keeps what was received. */
  incomeUpdated(userId: string, before: Income, after: Income) {
    if (before.frequency === "once") this.removeRecordsOf(userId, before.id);
    if (before.frequency === "once" || after.frequency === "once") this.watermarks.delete(before.id);
  }

  /** Call after an income schedule is deleted: received rows stay unlinked, except a one-time income's own row. */
  incomeDeleted(userId: string, before: Income) {
    if (before.frequency === "once") this.removeRecordsOf(userId, before.id);
    for (const row of this.incomeRecords(userId).values()) if (row.incomeId === before.id) row.incomeId = null;
    this.watermarks.delete(before.id);
  }

  private removeRecordsOf(userId: string, incomeId: string) {
    const records = this.incomeRecords(userId);
    for (const [id, row] of records) if (row.incomeId === incomeId) records.delete(id);
  }
}
