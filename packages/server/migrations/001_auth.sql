CREATE TABLE IF NOT EXISTS auth_users (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  email text NOT NULL UNIQUE CHECK (char_length(email) <= 254 AND email = lower(email)),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A session is one refresh-token family, not all sessions for an account.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  access_hash text NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_hash text NOT NULL UNIQUE,
  refresh_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);

-- Retain consumed tokens so replays (and logout using an old cookie) revoke the family.
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  token_hash text PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_refresh_tokens_session_idx ON auth_refresh_tokens(session_id);

CREATE TABLE IF NOT EXISTS auth_login_limits (
  key_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0)
);
