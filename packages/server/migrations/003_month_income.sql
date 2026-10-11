CREATE TABLE IF NOT EXISTS finance_income_entries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (
    month BETWEEN DATE '0001-01-01' AND DATE '9999-12-01'
    AND EXTRACT(DAY FROM month) = 1
  ),
  amount numeric(15,2) NOT NULL CHECK (amount > 0 AND amount <= 1000000000000),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500 AND btrim(description) <> '')
);

CREATE INDEX IF NOT EXISTS finance_income_entries_user_id_idx ON finance_income_entries(user_id, id);
CREATE INDEX IF NOT EXISTS finance_income_entries_user_month_idx ON finance_income_entries(user_id, month);
