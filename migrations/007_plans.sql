ALTER TABLE finance_settings ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh' CHECK (char_length(timezone) BETWEEN 1 AND 64);

CREATE TABLE IF NOT EXISTS finance_plans (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  amount numeric(15,2) NOT NULL CHECK (amount > 0 AND amount <= 1000000000000),
  description text NOT NULL CHECK (char_length(description) <= 1000),
  category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 100),
  time time(0) NOT NULL CHECK (time >= TIME '00:00' AND time < TIME '24:00' AND EXTRACT(SECOND FROM time) = 0),
  start_date date NOT NULL CHECK (start_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  frequency text NOT NULL CHECK (frequency IN ('once', 'daily', 'weekdays', 'weekly', 'monthly')),
  interval int NOT NULL DEFAULT 1 CHECK (interval BETWEEN 1 AND 365),
  days_of_week jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(days_of_week) = 'array'),
  end_date date CHECK (end_date IS NULL OR end_date >= start_date),
  materialized_through timestamp(0) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_plans_user_idx ON finance_plans(user_id, created_at);

CREATE TABLE IF NOT EXISTS finance_plan_exceptions (
  plan_id uuid NOT NULL REFERENCES finance_plans(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('skip', 'override')),
  amount numeric(15,2) CHECK (amount IS NULL OR (amount > 0 AND amount <= 1000000000000)),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  PRIMARY KEY (plan_id, date),
  CHECK ((kind = 'skip' AND amount IS NULL AND description IS NULL) OR (kind = 'override' AND amount IS NOT NULL))
);

ALTER TABLE finance_spendings ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES finance_plans(id) ON DELETE SET NULL;

ALTER TABLE finance_spendings ADD COLUMN IF NOT EXISTS plan_date date;

CREATE UNIQUE INDEX IF NOT EXISTS finance_spendings_plan_occurrence_idx ON finance_spendings(plan_id, plan_date);
