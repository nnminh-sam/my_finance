import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { ACCESS_SECONDS, REFRESH_SECONDS } from "./crypto";

export interface User { id: string; name: string; email: string; createdAt: string }
export interface Account extends User { passwordHash: string }
export interface TokenHashes { accessHash: string; refreshHash: string }
export interface AuthStore {
  reserveAttempt(keyHash: string): Promise<boolean>;
  findAccount(email: string): Promise<Account | undefined>;
  register(name: string, email: string, passwordHash: string, tokens: TokenHashes): Promise<User | undefined>;
  createSession(userId: string, tokens: TokenHashes): Promise<void>;
  rotate(oldHash: string, tokens: TokenHashes): Promise<User | undefined>;
  revoke(refreshHash?: string, accessHash?: string): Promise<void>;
  authenticate(accessHash: string): Promise<User | undefined>;
}

type Row = Record<string, unknown>;
function user(row: Row): User {
  return { id: String(row.id), name: String(row.name), email: String(row.email), createdAt: new Date(String(row.created_at)).toISOString() };
}

export function createStore(databaseUrl: string): AuthStore {
  const sql = neon(databaseUrl);
  const query = async (text: string, params: unknown[] = []): Promise<Row[]> => await sql.query(text, params) as Row[];
  const insertSession = `INSERT INTO auth_sessions
    (id, user_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
    VALUES ($1, $2, $3, now() + interval '${ACCESS_SECONDS} seconds', $4, now() + interval '${REFRESH_SECONDS} seconds') RETURNING id, refresh_hash`;
  return {
    async reserveAttempt(keyHash) {
      const rows = await query(`INSERT INTO auth_login_limits (key_hash, window_started_at, attempts)
        VALUES ($1, statement_timestamp(), 1)
        ON CONFLICT (key_hash) DO UPDATE SET
          attempts = CASE WHEN auth_login_limits.window_started_at <= statement_timestamp() - interval '15 minutes' THEN 1 ELSE auth_login_limits.attempts + 1 END,
          window_started_at = CASE WHEN auth_login_limits.window_started_at <= statement_timestamp() - interval '15 minutes' THEN statement_timestamp() ELSE auth_login_limits.window_started_at END
        RETURNING attempts`, [keyHash]);
      return Number(rows[0].attempts) <= 10;
    },
    async findAccount(email) {
      const rows = await query("SELECT * FROM auth_users WHERE email = $1", [email]);
      return rows[0] ? { ...user(rows[0]), passwordHash: String(rows[0].password_hash) } : undefined;
    },
    async register(name, email, passwordHash, tokens) {
      const rows = await query(`WITH new_user AS (
          INSERT INTO auth_users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)
          ON CONFLICT (email) DO NOTHING RETURNING *
        ), session AS (
          INSERT INTO auth_sessions (id, user_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
          SELECT $5, id, $6, now() + interval '${ACCESS_SECONDS} seconds', $7, now() + interval '${REFRESH_SECONDS} seconds' FROM new_user RETURNING id, refresh_hash
        ), history AS (
          INSERT INTO auth_refresh_tokens (token_hash, session_id) SELECT refresh_hash, id FROM session
        ) SELECT * FROM new_user`, [randomUUID(), name, email, passwordHash, randomUUID(), tokens.accessHash, tokens.refreshHash]);
      return rows[0] ? user(rows[0]) : undefined;
    },
    async createSession(userId, tokens) {
      await query(`WITH session AS (${insertSession})
        INSERT INTO auth_refresh_tokens (token_hash, session_id) SELECT refresh_hash, id FROM session`,
        [randomUUID(), userId, tokens.accessHash, tokens.refreshHash]);
    },
    async rotate(oldHash, tokens) {
      // Target the stable family ID, not the mutable current hash. PostgreSQL
      // re-evaluates SET expressions against the locked row after a concurrent
      // update: a losing request sees the consumed hash and atomically revokes.
      const eligible = "revoked_at IS NULL AND refresh_hash = $1 AND refresh_expires_at > now()";
      const rows = await query(`WITH rotated AS (
          UPDATE auth_sessions SET
            access_hash = CASE WHEN ${eligible} THEN $2 ELSE access_hash END,
            access_expires_at = CASE WHEN ${eligible} THEN now() + interval '${ACCESS_SECONDS} seconds' ELSE access_expires_at END,
            refresh_hash = CASE WHEN ${eligible} THEN $3 ELSE refresh_hash END,
            refresh_expires_at = CASE WHEN ${eligible} THEN now() + interval '${REFRESH_SECONDS} seconds' ELSE refresh_expires_at END,
            revoked_at = CASE WHEN ${eligible} THEN NULL ELSE COALESCE(revoked_at, now()) END
          WHERE id = (SELECT session_id FROM auth_refresh_tokens WHERE token_hash = $1)
          RETURNING id, user_id, refresh_hash, revoked_at
        ), history AS (
          INSERT INTO auth_refresh_tokens (token_hash, session_id)
          SELECT refresh_hash, id FROM rotated WHERE revoked_at IS NULL
        ) SELECT u.* FROM auth_users u JOIN rotated r ON r.user_id = u.id WHERE r.revoked_at IS NULL`, [oldHash, tokens.accessHash, tokens.refreshHash]);
      return rows[0] ? user(rows[0]) : undefined;
    },
    async revoke(refreshHash, accessHash) {
      // Resolve both credentials against this statement's snapshot before taking
      // the update lock. A concurrent refresh must not remove the bearer target
      // when PostgreSQL rechecks the predicate against the updated row.
      await query(`WITH target_sessions AS MATERIALIZED (
          SELECT session_id AS id FROM auth_refresh_tokens WHERE token_hash = $1
          UNION
          SELECT id FROM auth_sessions WHERE access_hash = $2
        ) UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now())
        WHERE id IN (SELECT id FROM target_sessions)`, [refreshHash ?? null, accessHash ?? null]);
    },
    async authenticate(accessHash) {
      const rows = await query(`SELECT u.* FROM auth_users u JOIN auth_sessions s ON s.user_id = u.id
        WHERE s.access_hash = $1 AND s.revoked_at IS NULL
          AND s.access_expires_at > now() AND s.refresh_expires_at > now()`, [accessHash]);
      return rows[0] ? user(rows[0]) : undefined;
    },
  };
}
