// Checks migration 011 on a database: writes every due income row, then compares, per user and month up to
// today, the income the old code computed from schedules with the sum of the new income rows.
// Usage: DATABASE_URL=... npx tsx scripts/verify-ledger.ts   (exit code 1 on any difference)
import { neon } from "@neondatabase/serverless";
import { getRangeIncome, monthRange } from "../src/lib/income";
import { addDays, localNowStamp } from "../src/lib/plans";
import { createFinanceStore } from "../src/server/finance/store";
import type { Income } from "../src/server/finance/model";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = neon(url);
  const store = createFinanceStore(url);
  const users = await sql.query(`SELECT DISTINCT i.user_id::text AS user_id,
      COALESCE(s.timezone, 'Asia/Ho_Chi_Minh') AS timezone
    FROM finance_incomes i LEFT JOIN finance_settings s ON s.user_id = i.user_id`) as { user_id: string; timezone: string }[];
  let differences = 0, months = 0, rows = 0;
  for (const user of users) {
    await store.materializeIncomes(user.user_id);
    const today = localNowStamp(user.timezone).slice(0, 10);
    const incomes: Income[] = [];
    for (let cursor: string | undefined, page; (page = await store.listIncomes(user.user_id, 500, cursor)); cursor = page.nextCursor ?? undefined) {
      incomes.push(...page.incomes);
      if (!page.nextCursor) break;
    }
    const recorded = await sql.query(`SELECT to_char(date, 'YYYY-MM') AS month, sum(amount)::text AS total, count(*)::int AS n
      FROM finance_spendings WHERE user_id = $1 AND kind = 'income' AND income_id IS NOT NULL GROUP BY 1`, [user.user_id]) as { month: string; total: string; n: number }[];
    const actual = new Map(recorded.map(row => [row.month, Math.round(Number(row.total) * 100)]));
    rows += recorded.reduce((sum, row) => sum + row.n, 0);
    // Two days early: a weekend shift can pay the first payday in the month before its start date.
    const first = addDays(incomes.reduce((min, item) => item.startDate < min ? item.startDate : min, today), -2).slice(0, 7);
    for (let month = first; month <= today.slice(0, 7); month = nextMonth(month)) {
      const { start, end } = monthRange(month);
      const expected = Math.round(getRangeIncome(start, end < today ? end : today, incomes).totalIncome * 100);
      const got = actual.get(month) ?? 0;
      months++;
      if (expected !== got) {
        differences++;
        console.log(`DIFF user ${user.user_id.slice(0, 8)} ${month}: schedules ${expected / 100}, rows ${got / 100}`);
      }
    }
  }
  console.log(`Checked ${users.length} users, ${months} months, ${rows} income rows: ${differences} differences.`);
  if (differences) process.exitCode = 1;
}

function nextMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return number === 12 ? `${String(year + 1).padStart(4, "0")}-01` : `${month.slice(0, 5)}${String(number + 1).padStart(2, "0")}`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exitCode = 1;
});
