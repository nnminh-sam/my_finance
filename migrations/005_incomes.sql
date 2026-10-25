-- Income sources: each row is one income stream (salary, freelance, allowance, gift, ...)
-- that occurs once or repeats daily, weekly, monthly, or yearly from start_date until end_date.
-- Statements are split on semicolons, so comments must not contain them.
CREATE TABLE IF NOT EXISTS finance_incomes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 100 AND btrim(source) <> ''),
  name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 500),
  amount numeric(15,2) NOT NULL CHECK (amount > 0 AND amount <= 1000000000000),
  frequency text NOT NULL CHECK (frequency IN ('once', 'daily', 'weekly', 'monthly', 'yearly')),
  start_date date NOT NULL CHECK (start_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  end_date date CHECK (end_date IS NULL OR end_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (frequency <> 'once' OR end_date IS NULL)
);

CREATE INDEX IF NOT EXISTS finance_incomes_user_id_idx ON finance_incomes(user_id, id);

-- Marks users whose legacy income (finance_settings.income and finance_income_entries)
-- has been copied, so rerunning this file never copies it again or restores deleted rows.
CREATE TABLE IF NOT EXISTS finance_income_migrations (
  user_id uuid PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  migrated_at timestamptz NOT NULL DEFAULT now()
);

-- Recurring base income becomes a monthly Salary source starting at the earlier of the
-- account creation month and the first month with spending. The row reuses the user ID as its ID.
INSERT INTO finance_incomes (id, user_id, source, name, amount, frequency, start_date)
SELECT s.user_id, s.user_id, 'Salary', 'Recurring monthly income', s.income, 'monthly',
  LEAST(
    date_trunc('month', u.created_at)::date,
    (SELECT date_trunc('month', min(sp.date))::date FROM finance_spendings sp WHERE sp.user_id = s.user_id)
  )
FROM finance_settings s
JOIN auth_users u ON u.id = s.user_id
WHERE s.income > 0
  AND NOT EXISTS (SELECT 1 FROM finance_income_migrations m WHERE m.user_id = s.user_id)
ON CONFLICT (id) DO NOTHING;

-- Month-specific additional income becomes one-time income on the first day of its month.
INSERT INTO finance_incomes (id, user_id, source, name, amount, frequency, start_date)
SELECT e.id, e.user_id, 'Other', e.description, e.amount, 'once', e.month
FROM finance_income_entries e
WHERE NOT EXISTS (SELECT 1 FROM finance_income_migrations m WHERE m.user_id = e.user_id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance_income_migrations (user_id)
SELECT id FROM auth_users
ON CONFLICT (user_id) DO NOTHING;
