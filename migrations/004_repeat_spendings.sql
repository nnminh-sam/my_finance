CREATE TABLE IF NOT EXISTS finance_repeat_rules (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  amount numeric(15,2) NOT NULL CHECK (amount > 0 AND amount <= 1000000000000),
  description text NOT NULL CHECK (char_length(description) <= 1000),
  category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 100),
  start_date date NOT NULL CHECK (start_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  time time(0) NOT NULL CHECK (time >= TIME '00:00' AND time < TIME '24:00' AND EXTRACT(SECOND FROM time) = 0),
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekdays', 'weekly', 'monthly')),
  interval int NOT NULL DEFAULT 1 CHECK (interval >= 1 AND interval <= 365),
  days_of_week jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(days_of_week) = 'array'),
  end_type text NOT NULL CHECK (end_type IN ('unlimited', 'occurrences', 'until_date')),
  total_occurrences int CHECK (total_occurrences IS NULL OR (total_occurrences >= 1 AND total_occurrences <= 100)),
  end_date date CHECK (end_date IS NULL OR (end_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')),
  occurrences_created int NOT NULL DEFAULT 0 CHECK (occurrences_created >= 0),
  last_generated_date date CHECK (last_generated_date IS NULL OR (last_generated_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE finance_spendings ADD COLUMN IF NOT EXISTS repeat_rule_id uuid REFERENCES finance_repeat_rules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS finance_repeat_rules_user_id_idx ON finance_repeat_rules(user_id, id);

CREATE INDEX IF NOT EXISTS finance_spendings_repeat_rule_id_idx ON finance_spendings(repeat_rule_id);
