-- One typed ledger: finance_spendings now holds every real money movement, with kind 'expense' or 'income'.
-- The table keeps its name because migrations 002, 004 and 007 alter it and every migration reruns.
-- Income schedules in finance_incomes write one 'income' row per payday once the payday has passed,
-- the same way plans write spendings. Every statement is rerunnable and adds, never rewrites.
-- Statements are split on semicolons, so comments must not contain them.
ALTER TABLE finance_spendings ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expense';

ALTER TABLE finance_spendings DROP CONSTRAINT IF EXISTS finance_spendings_kind_check;

ALTER TABLE finance_spendings ADD CONSTRAINT finance_spendings_kind_check CHECK (kind IN ('expense', 'income'));

-- ON DELETE SET NULL: deleting an income schedule keeps the money already received.
ALTER TABLE finance_spendings ADD COLUMN IF NOT EXISTS income_id uuid REFERENCES finance_incomes(id) ON DELETE SET NULL;

-- The nominal payday this row came from. The row date is the paid day, which a weekend shift can move earlier.
ALTER TABLE finance_spendings ADD COLUMN IF NOT EXISTS income_date date;

ALTER TABLE finance_spendings DROP CONSTRAINT IF EXISTS finance_spendings_kind_links_check;

-- Plan and repeat-rule links belong to expenses, income links to income.
ALTER TABLE finance_spendings ADD CONSTRAINT finance_spendings_kind_links_check CHECK (
  (kind = 'expense' AND income_id IS NULL AND income_date IS NULL)
  OR (kind = 'income' AND plan_id IS NULL AND plan_date IS NULL AND repeat_rule_id IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_spendings_income_occurrence_idx ON finance_spendings(income_id, income_date);

CREATE INDEX IF NOT EXISTS finance_spendings_user_kind_date_idx ON finance_spendings(user_id, kind, date);

-- Local date and time up to which paydays are written as rows. NULL means none yet, so the first
-- run writes every past payday from start_date. The server does this, because the payday rules
-- (weekend shift, twice a month, short months) live in src/lib/income.ts.
ALTER TABLE finance_incomes ADD COLUMN IF NOT EXISTS materialized_through timestamp(0)
