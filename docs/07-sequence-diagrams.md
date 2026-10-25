# 07. Sequence Diagrams

This document captures the detailed runtime interaction sequences of **MyFinance** across browser tabs, React contexts, Next.js Route Handlers, and Neon PostgreSQL transactions.

---

## 1. User Sign-In & Cross-Tab Session Broadcast

When a user signs in on `/login`, the client coordinates session state across tabs using the **Web Locks API** and **BroadcastChannel**, while the Next.js Route Handler enforces rate limiting, constant-time `scrypt` verification, and `HttpOnly` refresh cookie issuance.

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant TabA as Tab A (AuthScreen / auth.ts)
    participant Locks as Browser Web Locks & localStorage
    participant TabB as Tab B (BroadcastChannel 'mf-auth')
    participant API as Next.js Auth Route Handler (/api/v1/auth)
    participant DB as Neon PostgreSQL

    User->>TabA: Submit email & password on /login
    TabA->>Locks: navigator.locks.request('mf-auth-mutation')
    activate Locks
    Locks-->>TabA: Lock acquired (verifies localStorage writable)

    TabA->>API: POST /api/v1/auth/login (Origin: APP_ORIGIN, credentials: 'include')
    API->>API: Verify Origin === config.appOrigin
    API->>DB: INSERT INTO auth_login_limits ... ON CONFLICT DO UPDATE (<= 10 per 15m)
    DB-->>API: attempts <= 10 (Allowed)

    API->>DB: SELECT * FROM auth_users WHERE email = $1
    DB-->>API: Account row (or undefined)
    API->>API: verifyPassword(password, account?.passwordHash ?? DUMMY_PASSWORD_HASH)
    API->>API: Generate 256-bit accessToken & refreshToken + SHA-256 hashes

    API->>DB: CTE: INSERT INTO auth_sessions + INSERT INTO auth_refresh_tokens
    DB-->>API: Session created
    API-->>TabA: 200 OK { user, accessToken, expiresIn: 900 } + Set-Cookie: mf_refresh (HttpOnly, SameSite=Lax)

    TabA->>Locks: Increment revision & save { revision, generation } in localStorage
    TabA->>TabA: Store session in memory & schedule refreshTimer (expiresIn - 60s)
    TabA->>TabB: BroadcastChannel.postMessage({ type: 'session', revision, session })
    TabB->>TabB: Apply session in memory & update AuthContext
    TabA->>Locks: Release 'mf-auth-mutation' lock
    deactivate Locks

    TabA->>TabA: window.location.replace(safeReturnPath(next))
```

---

## 2. Single-Flight Token Rotation & Replay Detection

When an access token is within 60 seconds of expiry, when a page reloads (`restoreSession`), or when a protected API request receives `401 Unauthorized`, the client performs a lock-serialized refresh rotation. If a consumed refresh token is replayed, PostgreSQL atomically revokes the entire session family.

```mermaid
sequenceDiagram
    autonumber
    participant Client as Client (authenticatedFetch / auth.ts)
    participant Lock as Web Lock ('mf-auth-mutation')
    participant API as Next.js Route Handler (/api/v1/auth/refresh)
    participant DB as Neon PostgreSQL (auth_sessions & auth_refresh_tokens)

    Client->>Lock: Acquire Web Lock (single-flight refreshPromise)
    activate Lock
    Client->>Client: Check if sibling tab already refreshed (revision == meta.revision)
    alt Token still expired or rejected
        Client->>API: POST /api/v1/auth/refresh (Cookie: mf_refresh=#lt;oldToken#gt;)
        API->>API: Hash oldToken (SHA-256) & generate new access + refresh tokens
        API->>DB: Single-statement CTE: UPDATE auth_sessions WHERE id = (SELECT session_id FROM auth_refresh_tokens WHERE token_hash = $1)
        alt Valid Active Refresh Token (revoked_at IS NULL AND refresh_hash = $1)
            DB->>DB: Update access_hash & refresh_hash, insert new refresh_hash into auth_refresh_tokens
            DB-->>API: Returns authenticated User row
            API-->>Client: 200 OK { user, accessToken, expiresIn } + Set-Cookie: mf_refresh=#lt;newToken#gt;
            Client->>Client: publishSession(next) -> update localStorage revision & BroadcastChannel
        else Replay Detected (Token was already rotated or session revoked)
            DB->>DB: CASE WHEN eligible fails -> sets revoked_at = COALESCE(revoked_at, now()) on family!
            DB-->>API: Returns 0 eligible rows
            API-->>Client: 401 Unauthorized + Clear-Cookie: mf_refresh
            Client->>Client: publishSession(null) -> sign out all tabs immediately
        end
    end
    Client->>Lock: Release Web Lock
    deactivate Lock
```

---

## 3. Protected Page Load, Initial Fetch & Date-Range Spending Loading

When an authenticated user opens a protected page (e.g., `/week?date=2026-10-17`), Next.js mounts the persistent `(finance)` layout shell (`src/app/(finance)/layout.tsx`). `FinanceProvider.reload()` loads **settings, income entries, and repeat rules** in parallel. Spendings are **not** part of `reload()`: they are fetched per date range through `fetchWeeksSpendings`, and the backend syncs due repeat rules (14-day horizon) before answering each spendings or repeat-rules read.

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant Browser as Browser (/week -> src/app/(finance)/week/page.tsx)
    participant Shell as Persistent Shell ((finance)/layout.tsx)
    participant FinCtx as FinanceContext & services/finance.ts
    participant API as Next.js Finance Route Handler (/api/v1/finance)
    participant Store as FinanceStore & RecurrenceEngine
    participant DB as Neon PostgreSQL

    User->>Browser: Navigate to /week?date=2026-10-17
    Browser->>Browser: Root layout mounts ThemeProvider + AuthProvider -> restoreSession()
    Browser->>Shell: Mount Finance Shell (auth guard, persists across next/link navigations)
    Shell->>FinCtx: Mount FinanceProvider(userId) -> reload() (serialized, single-flight)

    par reload(): settings, income entries, repeat rules
        FinCtx->>API: GET /settings (Bearer token)
        API->>Store: getSettings(userId)
        Store->>DB: Transaction (ReadCommitted): INSERT default ON CONFLICT DO NOTHING + SELECT
        DB-->>FinCtx: 200 { settings }
    and
        FinCtx->>API: GET /income-entries?limit=500 (repeat with cursor until null)
        API->>DB: SELECT ... WHERE user_id = $1 AND id > cursor ORDER BY id LIMIT 501
        DB-->>FinCtx: 200 { incomeEntries, nextCursor }
    and
        FinCtx->>API: GET /repeat-rules
        API->>Store: listRepeatRules(userId) -> syncRepeatSpendings(userId)
        Store->>DB: SELECT ... FROM finance_repeat_rules ORDER BY created_at DESC
        DB-->>FinCtx: 200 { repeatRules }
    end
    FinCtx-->>Shell: hasLoaded = true -> FinanceGate renders SettingsProvider + header + page

    Shell->>FinCtx: fetchWeeksSpendings(date - 1 month (1st), date + 2 months (1st))
    FinCtx->>API: GET /spendings?limit=500&startDate=2026-09-01&endDate=2026-12-01
    API->>Store: listSpendings(userId, 500, cursor, startDate, endDate)
    Store->>Store: syncRepeatSpendings(userId, today UTC) (errors swallowed)
    loop For each rule where isRuleDueForSync(rule, today)
        Store->>Store: generateOccurrences(rule, 100)
        Store->>DB: Transaction: UPDATE finance_repeat_rules + bulk INSERT finance_spendings
    end
    Store->>DB: SELECT ... WHERE user_id = $1 AND date BETWEEN $4 AND $5 AND id > cursor ORDER BY id LIMIT 501
    DB-->>FinCtx: 200 { spendings, nextCursor } (loop until nextCursor is null)
    FinCtx->>FinCtx: Merge by id into shared spendings state
    FinCtx-->>Browser: WeekView re-renders with the loaded range
```

**Per-page spending loading:**

| Page | What triggers `fetchWeeksSpendings` | Range |
| :--- | :--- | :--- |
| `/calendar` | `CalendarView` initial window and scroll (`getNextWeeksToFetch`) | Week batches (3 weeks per step, 4-week buffer); `?date=` is ignored and the view starts on the current month |
| `/cycle` | Shell prefetch + `SalaryCycleView` for the cycle grid | Shell window plus first Monday to last Sunday of the cycle grid |
| `/week`, `/day`, `/analytics` | Shell prefetch when the URL date changes | 1st of (date − 1 month) to 1st of (date + 2 months) |
| `/profile` | none | — |

Window focus and the header **Refresh** button call `reload()` again, which refreshes settings, income entries, and repeat rules. Already-loaded spendings stay in memory; ranges are fetched again when the shell date changes.

---

## 4. Creating an Expense or Repeat Rule with Per-User Row Locking

To prevent race conditions between category edits and expense creation, all expense and repeat-rule writes serialize on the user's `finance_settings` row using `SELECT ... FOR UPDATE` inside a `ReadCommitted` transaction.

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant Modal as ExpenseModal.tsx
    participant FinCtx as FinanceContext (Serialized Queue)
    participant API as Next.js Finance Route Handler (/api/v1/finance)
    participant Store as FinanceStore (src/server/finance/store.ts)
    participant DB as Neon PostgreSQL

    User->>Modal: Fill expense form (One-time OR Repeat Rule) & click Save
    Modal->>FinCtx: createSpending(input) OR createRepeatRule(input)
    FinCtx->>FinCtx: Enqueue in serialize() queue & verify currentAccount()

    alt One-Time Expense (POST /api/v1/finance/spendings)
        FinCtx->>API: POST /api/v1/finance/spendings (Origin: APP_ORIGIN, Bearer token)
        API->>API: ValidateOrigin + authenticateRequest + spendingInput(body)
        API->>Store: createSpending(userId, validatedInput)
        Store->>DB: BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED
        Store->>DB: 1. INSERT INTO finance_settings ... ON CONFLICT DO NOTHING
        Store->>DB: 2. SELECT user_id FROM finance_settings WHERE user_id = $1 FOR UPDATE
        Store->>DB: 3. INSERT INTO finance_spendings ... WHERE EXISTS (category in finance_settings.categories) RETURNING *
        DB-->>Store: Commit & return created Spending row
        Store-->>API: Spending object
        API-->>FinCtx: 201 Created { spending }
    else Recurring Spending Rule (POST /api/v1/finance/repeat-rules)
        FinCtx->>API: POST /api/v1/finance/repeat-rules (Origin: APP_ORIGIN, Bearer token)
        API->>API: ValidateOrigin + authenticateRequest + repeatRuleInput(body)
        API->>Store: createRepeatRule(userId, validatedInput)
        Store->>DB: Transaction 1 (ReadCommitted): ensure(userId) + lock(userId) + verify category allowed
        Store->>Store: generateOccurrences(ruleState, maxBatch = 100)
        Store->>DB: Transaction 2 (ReadCommitted): INSERT finance_repeat_rules + Bulk INSERT finance_spendings (up to 100 rows)
        DB-->>Store: Commit & return { repeatRule, spendings }
        Store-->>API: { repeatRule, spendings }
        API-->>FinCtx: 201 Created { repeatRule, spendings }
    end

    FinCtx->>FinCtx: Update in-memory spendings / repeatRules state
    FinCtx-->>Modal: Resolve promise -> Close modal & show confirmation banner
```

---

## 5. User Logout & Materialized Session Family Revocation

When a user signs out, the Next.js Route Handler clears the `mf_refresh` cookie first and revokes both the refresh cookie's session family and the bearer token's session family using a `MATERIALIZED` CTE snapshot so concurrent token rotations cannot evade revocation.

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant Client as Client (auth.ts signOut)
    participant Lock as Web Lock & BroadcastChannel
    participant API as Next.js Route Handler (/api/v1/auth/logout)
    participant DB as Neon PostgreSQL

    User->>Client: Click "Sign out" on /profile
    Client->>Lock: Acquire Web Lock ('mf-auth-mutation')
    activate Lock
    Client->>API: POST /api/v1/auth/logout (Cookie: mf_refresh, Authorization: Bearer #lt;token#gt;)
    API->>API: Verify Origin === config.appOrigin
    API->>API: Clear mf_refresh cookie (Set-Cookie with Max-Age=0)
    API->>DB: WITH target_sessions AS MATERIALIZED (SELECT session_id FROM auth_refresh_tokens WHERE token_hash = $1 UNION SELECT id FROM auth_sessions WHERE access_hash = $2) UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id IN (SELECT id FROM target_sessions)
    DB-->>API: Session family(ies) revoked
    API-->>Client: 204 No Content

    Client->>Lock: publishSession(null) -> localStorage { revision: rev+1, generation: null }
    Client->>Lock: BroadcastChannel.postMessage({ type: 'session', session: null })
    Client->>Lock: Release Web Lock
    deactivate Lock
    Client->>Client: Redirect to /login
```

---

## 6. Salary Cycle View: Configure Payday & Load Cycle Spendings

The `/cycle` page computes pay periods entirely in the browser. Configuration changes are saved to `localStorage` and never sent to the server; only spendings for the cycle's date range are fetched.

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant View as SalaryCycleView.tsx
    participant Cycle as lib/salaryCycle.ts
    participant LS as localStorage (tracker_salary_cycle_v1_userId)
    participant FinCtx as FinanceContext (fetchWeeksSpendings)
    participant API as /api/v1/finance/spendings

    User->>View: Open /cycle?date=2026-10-17
    View->>Cycle: loadSalaryCycleConfig(userId)
    Cycle->>LS: getItem(key) -> validate & clamp (default: day 5, shift on, include next payday on)
    LS-->>View: SalaryCycleConfig
    View->>Cycle: getSalaryCycleForMonth(currentDate, config)
    Cycle->>Cycle: getPaydayForMonth(this month) and (next month): nominal day + weekend shift + month delay
    Cycle-->>View: { startDate, endDate, days, weeks (Mon–Sun grid) }
    View->>FinCtx: fetchWeeksSpendings(first grid Monday, last grid Sunday)
    FinCtx->>API: GET ?startDate=&endDate= (cursor loop)
    API-->>FinCtx: spendings (merged by id)
    View->>View: Sum cycle days: spending, category totals, peak day, income (anchor month), leftover

    User->>View: Pick base payday 10 / toggle weekend shift / set this month's payday +2 days
    View->>Cycle: clampSalaryDay / clampDelayDays
    View->>Cycle: saveSalaryCycleConfig(next, userId)
    Cycle->>LS: setItem(key, JSON)
    View->>Cycle: getSalaryCycleForMonth(currentDate, next)
    View->>FinCtx: fetchWeeksSpendings(new grid range) (effect re-runs on every cycle change)
    View-->>User: Re-rendered cycle grid & totals

    User->>View: Click a day
    View->>View: openDate(day) -> router.push(/day?date=YYYY-MM-DD)
```
