ALTER TABLE finance_plans ADD COLUMN IF NOT EXISTS sure boolean NOT NULL DEFAULT false;

ALTER TABLE finance_repeat_rules ADD COLUMN IF NOT EXISTS migrated_at timestamptz;

INSERT INTO finance_plans (id, user_id, amount, description, category, time, start_date, frequency, interval, days_of_week, end_date, materialized_through, sure, created_at)
SELECT r.id, r.user_id, r.amount, r.description, r.category, r.time, r.start_date, r.frequency, r.interval, r.days_of_week,
  CASE WHEN r.end_type = 'until_date' THEN r.end_date WHEN r.end_type = 'occurrences' THEN COALESCE(r.last_generated_date, r.start_date) ELSE NULL END,
  date_trunc('minute', now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Ho_Chi_Minh')), true, r.created_at
FROM finance_repeat_rules r LEFT JOIN finance_settings s ON s.user_id = r.user_id
WHERE r.migrated_at IS NULL
ON CONFLICT (id) DO NOTHING;

DELETE FROM finance_spendings sp USING finance_repeat_rules r, finance_settings s
WHERE sp.repeat_rule_id = r.id AND r.migrated_at IS NULL AND s.user_id = r.user_id
  AND sp.date + sp.time > (now() AT TIME ZONE s.timezone);

UPDATE finance_spendings sp SET plan_id = sp.repeat_rule_id, plan_date = sp.date
FROM finance_repeat_rules r
WHERE sp.repeat_rule_id = r.id AND r.migrated_at IS NULL AND sp.plan_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM finance_spendings o WHERE o.plan_id = sp.repeat_rule_id AND o.plan_date = sp.date);

UPDATE finance_repeat_rules SET migrated_at = now() WHERE migrated_at IS NULL;
