-- Show by preference: which period Calendar, Week, Day, Analytics and the phone screens group by.
-- Every statement is rerunnable.
-- Statements are split on semicolons, so comments must not contain them.
ALTER TABLE finance_settings ADD COLUMN IF NOT EXISTS show_by text NOT NULL DEFAULT 'calendar_month';

ALTER TABLE finance_settings DROP CONSTRAINT IF EXISTS finance_settings_show_by_check;

ALTER TABLE finance_settings ADD CONSTRAINT finance_settings_show_by_check
  CHECK (show_by IN ('calendar_month', 'pay_cycle'));
