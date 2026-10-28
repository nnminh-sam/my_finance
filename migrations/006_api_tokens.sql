CREATE TABLE IF NOT EXISTS auth_api_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  token_hash text NOT NULL UNIQUE,
  token_hint text NOT NULL CHECK (char_length(token_hint) <= 32),
  scope text NOT NULL CHECK (scope IN ('read', 'write')),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_api_tokens_user_idx ON auth_api_tokens(user_id);
