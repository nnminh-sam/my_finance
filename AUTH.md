# Authentication

Email/password authentication is implemented end-to-end in the React client and Express API. Users and sessions are persisted in Neon PostgreSQL. The client gates finance views behind login, provides registration and profile logout, restores sessions on reload, and refreshes access tokens automatically. Spending records and financial settings now use authenticated, user-scoped Neon persistence; see `FINANCE.md` for the finance API and migration.

Financial settings and categories are stored per account in Neon and load on each device after login. Legacy browser settings are left untouched but no longer read or imported. Light/dark appearance is available on both authentication and finance screens; it follows the system until explicitly chosen, then persists locally under `tracker_theme`.

## Setup

Requires Node.js 20+ and a Neon PostgreSQL database.

1. Install dependencies from the repository root: `npm install`.
2. Copy `.env.example` to root `.env`, supply a real Neon `DATABASE_URL`, and set `APP_ORIGIN` to the frontend's exact origin. Do not commit credentials.
3. Run `npm run db:migrate --workspace=@my-finance/server`. This applies checked-in numbered migrations in order, including `001_auth.sql` and `002_finance.sql`, each in its own transaction. These initial schema migrations are rerunnable without deleting existing records; later schema changes need new migrations. The runtime never creates tables. Use a role with DDL permissions for migration and a restricted DML role for runtime where possible.
4. Run `npm run dev:server` (port 4000 by default), or the root dev command. Local frontend requests to `/api/v1/...` must be proxied to port 4000; otherwise they reach the frontend server. The existing Vite proxy already routes `/api` to port 4000.
5. On Vercel, set `DATABASE_URL` and `APP_ORIGIN=https://your-frontend-host` in deployment environment variables. The existing `api/index.ts` imports the Express app; it does not run the local listener. Configure each preview deployment's exact frontend origin too. Vercel or `NODE_ENV=production` enables Secure cookies and requires an HTTPS origin.

Configuration searches upward from both the working directory and module directory for the repository, supporting local `tsx`, compiled `dist`, and Vercel. It also supports a standalone server package `.env`. Precedence is existing process environment > root `.env` > server `.env`; dotenv never overrides an already-set value. `DATABASE_URL` and `APP_ORIGIN` are validated at startup, with no secrets in validation errors. The default local origin is `http://localhost:5173`.

## HTTP contract

All endpoints are under `/api/v1/auth`. JSON bodies and responses use `Content-Type: application/json`. Every POST requires an `Origin` header **exactly matching** the configured `APP_ORIGIN`, including login, registration, refresh, and logout. Browser fetch supplies it automatically; scripts must supply it explicitly. Missing origins, `null`, and other origins receive 403. CORS allows credentials only for the configured origin, not `*`.

| Method / path    | Input                                                     | Success                  |
| ---------------- | --------------------------------------------------------- | ------------------------ |
| `POST /register` | `{name,email,password}`                                   | 201, auth response below |
| `POST /login`    | `{email,password}`                                        | 200, auth response       |
| `POST /refresh`  | empty body or `{}`, refresh cookie                        | 200, auth response       |
| `POST /logout`   | empty body or `{}`, refresh cookie and/or optional bearer | 204, clears cookie       |
| `GET /me`        | `Authorization: Bearer <accessToken>`                     | 200, `{user}`            |

Auth response (register/login/refresh):

```json
{
  "user": {
    "id": "uuid",
    "name": "Name",
    "email": "user@example.com",
    "createdAt": "ISO-8601 timestamp"
  },
  "accessToken": "opaque-random-token",
  "expiresIn": 900
}
```

Usernames are trimmed, 1–100 characters, without control characters. Emails are trimmed, lowercased, and validated (maximum 254 characters). Passwords are not trimmed; they require 12–128 JavaScript string characters and at most 512 UTF-8 bytes. Existing weak-password accounts are not supported by these rules. Duplicate registrations return a generic 400 error. Bad login credentials receive the same 401 error for unknown accounts and incorrect passwords. Errors use `{error: "safe message"}`; rate limits return 429 with `Retry-After: 900`; service failures return a generic 503. Logout returns 503, not a misleading 204, if database revocation fails, but still clears the browser cookie. A denied origin does not execute logout or clear the cookie.

`GET /api/v1/health` remains public; it is not a database readiness probe. No endpoint contract deviations; registration uses HTTP 201, and errors/validation are specified above.

### Integrated client

`packages/client/src/auth.ts` manages memory-only bearer tokens, single-flight refresh, and cross-tab session coordination. `AuthContext.tsx` exposes login/register/logout and session state. The profile displays Neon account details; account name/email editing is intentionally not implemented.

Use a current browser with **Web Locks, BroadcastChannel, and writable localStorage**, over HTTPS or localhost. Authentication fails closed without these capabilities to avoid concurrent token replay. Only non-secret revision/login-generation metadata is persisted for coordination; tokens are exchanged between same-origin tabs through BroadcastChannel. Ordered revisions discard stale broadcasts, and protected-request retries cannot switch to a replacement account. Automatic refresh runs roughly one minute before access expiry and once on a protected API 401. A failed refresh is not blindly retried.

Logout clears local authentication even when server revocation cannot be confirmed and shows a warning. Local logout metadata prevents automatic restoration on a later reload until an explicit login. The server may retain a session if revocation failed; this warning is not a guarantee of server-side revocation.

The finance API client uses `authenticatedFetch()` from `src/auth.ts`. Calendar, week, day, and analytics views consume Neon-backed records, and the day view supports creating, editing, and deleting expenses.

### API client usage

Use same-origin URLs and `credentials: "include"`. Keep access tokens in memory, not localStorage, and attach the bearer token to protected requests:

```ts
const response = await fetch("/api/v1/auth/login", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
// Handle non-2xx responses before using the body.
const { user, accessToken, expiresIn } = await response.json();

await fetch("/api/v1/auth/me", {
  credentials: "include",
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

On startup reload, refresh once to restore the in-memory token. **Serialize refresh across requests and tabs** (a single-flight promise and, across tabs, Web Locks/BroadcastChannel). Do not blindly retry a refresh after a network failure: it may have committed before the response was lost; reuse of that consumed cookie revokes the family. On 401, clear client auth state and sign in again. HTTP cookie responses from racing requests can arrive out of order, so synchronization must include processing the response, not just starting requests. A refresh invalidates the previous access token immediately; in-flight API requests using it can receive 401. Logout need not supply a bearer token; the matching cookie family is always revoked, even when the cookie was consumed by an earlier rotation. If a bearer references a different family, both families are revoked. Logout without credentials is idempotent 204.

## Security model

- Passwords use built-in asynchronous `crypto.scrypt` with a random 16-byte salt, N=32768, r=8, p=1, 64-byte output, bounded memory, and constant-time comparison. Encoded parameters/lengths are validated before derivation; unknown accounts perform dummy KDF work. A server-side pepper is not required.
- Both tokens have 256 bits of cryptographic randomness. Only SHA-256 token hashes enter SQL/storage; raw tokens are returned only to their intended browser. The access token lasts 15 minutes. The refresh cookie lasts 30 days from issuance/each rotation (sliding expiry, not an absolute family lifetime).
- `mf_refresh` is host-only, HttpOnly, SameSite=Lax, Secure in production, path `/api/v1/auth`. It has no Domain attribute. Registration/login/refresh set it; logout and rejected refresh clear it with the same attributes. Cross-site frontend/API deployments are intentionally unsupported by the Lax cookie; prefer same-origin routing.
- Strict mutation-origin checks are the CSRF defense, including login CSRF. CORS is restricted but is not itself the CSRF defense. Do not strip browser Origin headers at a proxy. Non-browser clients can forge Origin; it is not an authentication credential.
- One database statement locks/updates the session family, rotates both hashes, and inserts the new refresh hash into history. A concurrent loser re-evaluates the locked row, recognizes the consumed token, and revokes the family in the **same statement**. Exactly one request can win a rotation, but a replay/concurrent loser invalidates its returned tokens. Unknown tokens cannot revoke unrelated sessions. Revocation affects one family, not all devices.
- Consumed refresh hashes remain in `auth_refresh_tokens` to detect replay and allow logout from stale cookies. Logout materializes cookie/bearer matches into stable session IDs within its database statement, then revokes by ID: a refresh that changes the access hash while logout waits on a row lock cannot remove an already-resolved bearer target. A bearer rotated before logout's statement snapshot no longer matches; use the refresh cookie to revoke that family. Every bearer request checks current hash, access/refresh expiry, and revocation in the database. A request authorized just before concurrent revocation may already be executing; middleware cannot undo it.
- PostgreSQL-backed per-normalized-email rate limits reserve attempts atomically across serverless workers: 10 registration/login attempts per 15-minute fixed window, shared across both endpoints. Success does not reset it. Every expiry comparison and window assignment uses the same `statement_timestamp()`, so crossing an expiry boundary during evaluation cannot reset the window without resetting its counter. A statement that starts before expiry remains in the old window even if it waits on a row lock past expiry; the next post-expiry statement resets the window. Account-key hashes avoid storing emails in the limiter. This is **not** a complete anti-abuse system: arbitrary email addresses evade it and attackers can temporarily lock out an account. Add edge/WAF IP limits, resource budgets, and monitoring for production. No untrusted forwarded-IP header is used as an identity.
- All user-supplied SQL values are parameters. Unexpected errors omit driver details, SQL, tokens, and database URLs from responses and logs. Auth responses use `Cache-Control: no-store`. The application does not log credentials.
- Future APIs can import `requireAuth` from `packages/server/src/app.ts` and read `res.locals.user`. Register such routes **before** the terminal 404/error handlers in `createApplication`, or compose with `requireAuth(store)` from `src/auth/http.ts`. Authorization/data isolation must additionally constrain queries by the authenticated user ID; do not trust user IDs supplied by the client.

There is no email verification, password reset/change, MFA, account deletion, global device logout, in the authentication scope. Use HTTPS in production. Treat XSS as able to issue authenticated requests even though it cannot read the refresh cookie.

### Operational cleanup

Schedule database cleanup outside request handlers. Expired or revoked sessions can be deleted after your audit/retention interval; refresh history cascades on session deletion. Never prune history for a still-active family or replay protection would be lost. Expired limiter rows can be deleted (`window_started_at < now() - interval '15 minutes'`); this ends only an already-expired window. Sliding families can accumulate history for a long time; consider an absolute family lifetime and retention policy as a future change. Use connection roles/backups consistent with password-hash sensitivity.

## Validation

- `npm run build --workspace=@my-finance/server`
- `npm test --workspace=@my-finance/server`
- `npm test --workspace=@my-finance/client`
- `npm run build`

Tests use `node:test` with `tsx`: real password hashing, HTTP contracts, cookie flags, CSRF/origin checks, validation, generic errors, limiter behavior, rotation/replay, concurrency, expiry, logout with stale cookies/mismatched bearers, and safe service failures. HTTP tests use an injectable in-memory store; it is a test double only, never the production limiter or session store.

The Neon integration tests are skipped unless `AUTH_TEST_DATABASE_URL` is exported. Use an **isolated test database**, explicitly migrate it first (set `DATABASE_URL` to that test database for `db:migrate`), then export `AUTH_TEST_DATABASE_URL` when running tests. They verify real SQL concurrent refresh/revocation, expiry, registration conflict, and shared atomic rate limiting; they delete their test users/limit rows afterward. Focused race tests hold row locks with short `pg_sleep` transactions and observe their own backends through `pg_stat_activity`/`pg_blocking_pids`: bearer-only logout must revoke after an access-hash replacement, and an exhausted rate-limit attempt must preserve its pre-expiry window across a lock wait. These tests add about 16 seconds and require visibility of the test role's own backends; the limiter test asserts that its request reached PostgreSQL before expiry to distinguish excessive test-network latency from the regression. Tests do not automatically load `.env` for the test URL.

Client tests mock browser coordination and cover restore single-flight, refresh locking, stale broadcasts, account-switch races, and failed logout. They do not replace real multi-tab browser testing.

No npm installation, build, migration, or tests were executed by the coding agent: there was no terminal tool available. Editor diagnostics are the only available static check and cannot replace those commands. The Calendar category-icon prop mismatch was corrected while integrating the Neon-backed spending views.
