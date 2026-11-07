-- Pay schedules on incomes (every 2 or 4 weeks, twice a month, weekend shift)
-- and the budget period setting. Every statement is rerunnable.
-- Statements are split on semicolons, so comments must not contain them.
ALTER TABLE finance_incomes ADD COLUMN IF NOT EXISTS interval integer NOT NULL DEFAULT 1;

ALTER TABLE finance_incomes ADD COLUMN IF NOT EXISTS semimonthly_day_1 integer;

ALTER TABLE finance_incomes ADD COLUMN IF NOT EXISTS semimonthly_day_2 integer;

ALTER TABLE finance_incomes ADD COLUMN IF NOT EXISTS weekend_shift boolean NOT NULL DEFAULT false;

ALTER TABLE finance_incomes DROP CONSTRAINT IF EXISTS finance_incomes_frequency_check;

ALTER TABLE finance_incomes ADD CONSTRAINT finance_incomes_frequency_check
  CHECK (frequency IN ('once', 'daily', 'weekly', 'semimonthly', 'monthly', 'yearly'));

ALTER TABLE finance_incomes DROP CONSTRAINT IF EXISTS finance_incomes_interval_check;

ALTER TABLE finance_incomes ADD CONSTRAINT finance_incomes_interval_check
  CHECK (interval IN (1, 2, 4) AND (interval = 1 OR frequency = 'weekly'));

ALTER TABLE finance_incomes DROP CONSTRAINT IF EXISTS finance_incomes_semimonthly_check;

ALTER TABLE finance_incomes ADD CONSTRAINT finance_incomes_semimonthly_check
  CHECK (
    (frequency = 'semimonthly') = (semimonthly_day_1 IS NOT NULL AND semimonthly_day_2 IS NOT NULL)
    AND (semimonthly_day_1 IS NULL OR semimonthly_day_1 BETWEEN 1 AND 31)
    AND (semimonthly_day_2 IS NULL OR semimonthly_day_2 BETWEEN 1 AND 31)
    AND (semimonthly_day_1 IS NULL OR semimonthly_day_2 IS NULL OR semimonthly_day_1 < semimonthly_day_2)
  );

ALTER TABLE finance_incomes DROP CONSTRAINT IF EXISTS finance_incomes_weekend_shift_check;

ALTER TABLE finance_incomes ADD CONSTRAINT finance_incomes_weekend_shift_check
  CHECK (NOT weekend_shift OR frequency IN ('weekly', 'semimonthly', 'monthly', 'yearly'));

ALTER TABLE finance_settings ADD COLUMN IF NOT EXISTS budget_period_mode text NOT NULL DEFAULT 'calendar';

ALTER TABLE finance_settings DROP CONSTRAINT IF EXISTS finance_settings_budget_period_mode_check;

ALTER TABLE finance_settings ADD CONSTRAINT finance_settings_budget_period_mode_check
  CHECK (budget_period_mode IN ('calendar', 'monthly_from_day', 'paycheck'));

ALTER TABLE finance_settings ADD COLUMN IF NOT EXISTS budget_period_start_day integer NOT NULL DEFAULT 1;

ALTER TABLE finance_settings DROP CONSTRAINT IF EXISTS finance_settings_budget_period_start_day_check;

ALTER TABLE finance_settings ADD CONSTRAINT finance_settings_budget_period_start_day_check
  CHECK (budget_period_start_day BETWEEN 1 AND 28);

-- No CHECK ties mode paycheck to a non-null id, because ON DELETE SET NULL and the user cascade must never abort.
ALTER TABLE finance_settings ADD COLUMN IF NOT EXISTS paycheck_income_id uuid REFERENCES finance_incomes(id) ON DELETE SET NULL;
