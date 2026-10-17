CREATE TABLE IF NOT EXISTS finance_settings (
  user_id uuid PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  income numeric(15,2) NOT NULL DEFAULT 0 CHECK (income BETWEEN 0 AND 1000000000000),
  base_daily_spending numeric(15,2) NOT NULL DEFAULT 0 CHECK (base_daily_spending BETWEEN 0 AND 1000000000000),
  max_daily_spending numeric(15,2) NOT NULL DEFAULT 0 CHECK (max_daily_spending BETWEEN 0 AND 1000000000000),
  avatar text NOT NULL DEFAULT '' CHECK (char_length(avatar) <= 2048),
  categories jsonb NOT NULL CHECK (jsonb_typeof(categories) = 'array' AND jsonb_array_length(categories) <= 50)
);

-- Category IDs are historical values, not foreign keys to the mutable settings list.
CREATE TABLE IF NOT EXISTS finance_spendings (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  amount numeric(15,2) NOT NULL CHECK (amount > 0 AND amount <= 1000000000000),
  description text NOT NULL CHECK (char_length(description) <= 1000),
  category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 100),
  date date NOT NULL CHECK (date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  time time(0) NOT NULL CHECK (time >= TIME '00:00' AND time < TIME '24:00' AND EXTRACT(SECOND FROM time) = 0)
);
CREATE INDEX IF NOT EXISTS finance_spendings_user_id_idx ON finance_spendings(user_id, id);
