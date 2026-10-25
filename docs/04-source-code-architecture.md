# 04. Source Code Architecture

This document provides an in-depth architectural analysis of the source code for **MyFinance**, covering the Next.js 15 App Router frontend architecture, React context hierarchy, client-side coordination, and backend Web standard request processing engine.

---

## 1. Frontend Source Code Architecture

### 1.1 Next.js App Router Component Tree & Persistent Layouts

The application frontend is structured using Next.js 15 App Router conventions with React 19. Rather than recreating layout state on every route change, route groups provide specialized shell wrappers that preserve state and eliminate redundant network queries.

```mermaid
flowchart TB
    RootLayout["Root Layout (src/app/layout.tsx: Theme Init & noscript)"]
    Providers["Providers (src/app/providers.tsx)"]
    ThemeProv["ThemeProvider (contexts/ThemeContext.tsx)"]
    AuthProv["AuthProvider (contexts/AuthContext.tsx)"]

    subgraph AuthGroup["(auth) Route Group"]
        AuthLayout["Auth Layout (src/app/(auth)/layout.tsx: Guest Guard)"]
        LoginView["Login Page (src/app/(auth)/login/page.tsx -> AuthScreen.tsx)"]
        SignupView["Signup Page (src/app/(auth)/signup/page.tsx -> AuthScreen.tsx)"]
    end

    subgraph FinanceGroup["(finance) Route Group (Persistent Shell)"]
        FinLayout["Finance Layout (src/app/(finance)/layout.tsx: Auth Guard & Persistent Shell)"]
        FinShellCtx["FinanceShellContext (Modals State & Selected Date)"]
        FinProv["FinanceProvider (contexts/FinanceContext.tsx)"]
        SetProv["SettingsProvider (contexts/SettingsContext.tsx)"]
        FinHeader["Navigation Header (Date Pickers, Quick Add +, Profile Link)"]
        
        subgraph ActivePageView["Active Page View (Client-Side Swap via next/link)"]
            CalPage["Calendar (/calendar) -> CalendarView.tsx"]
            CycPage["Pay Cycle (/cycle) -> SalaryCycleView.tsx"]
            WkPage["Week (/week) -> WeekView.tsx"]
            DayPage["Day (/day) -> DayDetails.tsx"]
            AnaPage["Analytics (/analytics) -> AnalyticsView.tsx + charts.tsx"]
            ProfPage["Profile (/profile) -> UserProfile.tsx"]
        end

        subgraph PersistentModals["Shared Modals (Stay Mounted)"]
            ExpModal["ExpenseModal (Single & Repeat Expense Form)"]
            IncModal["MonthlyIncomeModal (Income Sources for One Month)"]
        end
    end

    RootLayout --> Providers
    Providers --> ThemeProv --> AuthProv
    AuthProv --> AuthLayout
    AuthProv --> FinLayout
    AuthLayout --> LoginView & SignupView
    FinLayout --> FinShellCtx --> FinProv --> SetProv
    SetProv --> FinHeader & ActivePageView & PersistentModals
    PersistentModals --> ExpModal & IncModal
    ActivePageView --> CalPage & CycPage & WkPage & DayPage & AnaPage & ProfPage
```

#### Key Layout Responsibilities

1. **Root Layout (`src/app/layout.tsx`)**:
   - Injects a synchronous inline script to read `localStorage.getItem('tracker_theme')` and set `document.documentElement.dataset.theme` before first paint, preventing theme flash.
   - Includes `<noscript>` warning explaining that JavaScript is required to access MyFinance.
   - Wraps the entire application in `ThemeProvider` and `AuthProvider`.
2. **Auth Route Group (`src/app/(auth)/layout.tsx`)**:
   - Manages public authentication pages (`/login` and `/signup`).
   - If the user is already authenticated, automatically redirects them to their requested destination via `safeReturnPath(next)` or `/calendar`.
3. **Finance Persistent Shell (`src/app/(finance)/layout.tsx`)**:
   - Enforces authentication: unauthenticated visitors are redirected to `/login?next=...`.
   - Wraps the tree in `FinanceProvider` (keyed by user ID), a `FinanceGate` that shows a loading/retry/sign-out screen until the first load succeeds, `SettingsProvider`, and `FinanceShellContext`.
   - Keeps the navigation bar (Calendar, Pay Cycle, Week, Analytics, Profile) and global modal components (`ExpenseModal`, `MonthlyIncomeModal`) mounted across client transitions. Clicking between `/calendar`, `/cycle`, `/week`, `/day`, `/analytics`, and `/profile` uses `next/link` to swap page views without re-fetching settings, income entries, or rules.
   - On `/cycle`, `/week`, `/day`, and `/analytics` it prefetches spendings for the window from one month before to two months after the URL date (`fetchWeeksSpendings`). `/calendar` ignores `?date=`, always starts on the current month, and loads its own week batches while scrolling.

---

### 1.2 Frontend Module Dependency Graph

```mermaid
flowchart LR
    subgraph Pages["Next.js App Pages (src/app)"]
        HomePage["page.tsx"]
        LoginPage["(auth)/login/page.tsx"]
        SignupPage["(auth)/signup/page.tsx"]
        CalPage["(finance)/calendar/page.tsx"]
        CycPage["(finance)/cycle/page.tsx"]
        WkPage["(finance)/week/page.tsx"]
        DayPage["(finance)/day/page.tsx"]
        AnaPage["(finance)/analytics/page.tsx"]
        ProfPage["(finance)/profile/page.tsx"]
    end

    subgraph Components["UI Components (src/components)"]
        AuthUI["AuthScreen.tsx"]
        CalendarUI["CalendarView.tsx"]
        CycleUI["SalaryCycleView.tsx"]
        WeekUI["WeekView.tsx"]
        DayUI["DayDetails.tsx"]
        AnalyticsUI["AnalyticsView.tsx & charts.tsx"]
        ProfileUI["UserProfile.tsx, IncomeSources.tsx ProfileUI["UserProfile.tsx & ProfileSection.tsx"] ProfileSection.tsx"]
        ExpenseUI["ExpenseModal.tsx"]
        IncomeUI["MonthlyIncomeModal.tsx & IncomeSources.tsx"]
    end

    subgraph Contexts["React Contexts (src/contexts)"]
        AuthCtx["AuthContext.tsx"]
        FinCtx["FinanceContext.tsx"]
        SetCtx["SettingsContext.tsx"]
        ThemeCtx["ThemeContext.tsx"]
        ShellCtx["FinanceShellContext.tsx"]
    end

    subgraph PureModules["Services, Domain Logic & Hooks"]
        AuthMod["services/auth.ts (Web Locks, BroadcastChannel, Memory Token)"]
        FinMod["services/finance.ts (API Client, Date Ranges & Cursor Traversal)"]
        NavMod["lib/navigation.ts (Date Query Builders & Safe Redirects)"]
        PagesMod["lib/pages.ts (Page Manifest & Metadata)"]
        AnaMod["lib/analytics.ts (OLS, Tukey, Pareto, Gini Engine)"]
        SpendMod["lib/spendings.ts (Date Filters & Currency Formatting)"]
        IncMod["lib/income.ts (Income Occurrences & Month Totals)"]
        HeatMod["lib/heatmap.ts (Spending Heatmap RGBA)"]
        CycleMod["lib/salaryCycle.ts (Payday & Cycle Range Engine)"]
        CalWinMod["lib/calendarWindow.ts (Scroll Window & Week Fetch Batches)"]
        DraftMod["lib/expenseDraft.ts & lib/incomeDraft.ts & hooks/useUnsavedChanges.ts"]
        BatchMod["lib/expenseBatch.ts"]
    end

    Pages --> Components
    Components --> Contexts
    Contexts --> PureModules
    AnalyticsUI --> AnaMod
    CalendarUI & WeekUI --> SpendMod & IncMod & HeatMod
    CalendarUI --> CalWinMod
    CycleUI --> CycleMod & SpendMod & IncMod
    DayUI --> SpendMod
    ProfileUI --> IncMod & DraftMod
    ExpenseUI --> DraftMod & BatchMod
    AuthCtx --> AuthMod
    FinCtx --> FinMod & AuthMod
    FinMod --> AuthMod
```

---

### 1.3 Cross-Tab Authentication State Machine (`src/services/auth.ts`)

[`src/services/auth.ts`](../src/services/auth.ts) implements a zero-trust, memory-only bearer token store synchronized across browser tabs:
- **No Tokens in Storage**: The active `accessToken` is stored strictly in JavaScript closure memory (`let session: Session | null`). `localStorage` holds only coordination metadata `{ revision: number, generation: string | null }` under the key `mf-auth-coordination`.
- **Cross-Tab Mutual Exclusion**: All login, signup, refresh, and logout operations acquire an exclusive browser lock via `navigator.locks.request('mf-auth-mutation', ...)` (`withAuthLock`), preventing concurrent tab races on the single-use `mf_refresh` cookie.
- **Cross-Tab Broadcast**: Upon acquiring the lock, `publishSession` updates `revision` and broadcasts `{ type: 'session', revision, session }` over `BroadcastChannel('mf-auth')` so all open tabs update their in-memory token simultaneously.

```mermaid
stateDiagram-v2
    [*] --> Restoring : Page Mount (restoreSession)
    Restoring --> Authenticated : POST /api/v1/auth/refresh succeeds (200)
    Restoring --> SignedOut : Refresh returns 401 or generation=null

    SignedOut --> Authenticating : signIn() / signUp() acquires Web Lock
    Authenticating --> Authenticated : 200/201 + publishSession (BroadcastChannel)
    Authenticating --> SignedOut : 400/401/429 Error

    state Authenticated {
        [*] --> ActiveToken
        ActiveToken --> Refreshing : Timer (expiresAt - 60s) OR Protected API 401
        Refreshing --> ActiveToken : Web Lock + POST /refresh (200) + Broadcast
    }

    Refreshing --> SignedOut : 401 Revoked/Expired + publishSession(null)
    Authenticated --> SigningOut : signOut() acquires Web Lock
    SigningOut --> SignedOut : POST /logout + publishSession(null, generation=null)
```

---

### 1.4 Serialized Finance State Queue (`src/contexts/FinanceContext.tsx`)

To avoid out-of-order state overwrites (for instance, a slow background refresh overwriting a freshly created expense), [`src/contexts/FinanceContext.tsx`](../src/contexts/FinanceContext.tsx) serializes all operations:
- `serialize(operation)` appends each mutation to a persistent promise chain (`queue.current`) and validates `currentAccount()` before and after execution.
- `reload()` coalesces concurrent reload triggers (page mount, window focus, manual refresh) into a single in-flight promise (`reloadFlight.current`). It loads **settings, incomes, and repeat rules only**, not spendings.
- `fetchWeeksSpendings(startDate, endDate)` loads spendings for a date window (`GET /spendings?startDate=&endDate=`, following cursors until exhausted), de-duplicates identical in-flight ranges (`inFlightRanges`), and merges results by ID into the shared `spendings` array. It is not part of the serialized queue; `spendings` holds the union of every range loaded so far in this session.
- Mutations (`createSpending`, `updateSpending`, `deleteSpending`, `createRepeatRule`, `deleteRepeatRule`, income CRUD, `updateSettings`) run through `serialize()` and patch local state with the server response.

---

### 1.5 Statistical Analytics & Forecasting Engine (`src/lib/analytics.ts`)

[`src/lib/analytics.ts`](../src/lib/analytics.ts) is a pure functional calculation engine (`computeMonthlyAnalytics`) that derives:
- **Descriptive Statistics**: Daily totals, 7-day trailing moving average (`ma7`), mean, median (`quantile(0.5)`), standard deviation (`stdDev`), and Z-scores.
- **Outlier Detection (Tukey's Fences)**: Computes interquartile range across active spending days; values exceeding $Q_3 + 1.5 \times (Q_3 - Q_1)$ are flagged as anomalies.
- **Cumulative OLS Forecasting**: Fits an Ordinary Least Squares regression $y = \text{slope} \cdot x + \text{intercept}$ over elapsed daily spend, projecting the end-of-month total with a $95\%$ confidence band ($\pm 1.96 \cdot \sigma \cdot \sqrt{k}$).
- **Concentration Analysis**: Computes the **Gini coefficient** and **Pareto 80% Lorenz curve** (fraction of spendings accounting for $80\%$ of total spend).
- **Temporal Patterns**: $7 \times 24$ weekday-by-hour matrix, day-of-week averages, and natural-language summaries (`buildInsights`).

---

### 1.6 Income Sources & Monthly Income (`src/lib/income.ts`)

Income is a list of sources (`Income`: `source`, `name`, `amount` per payment, `frequency`, `startDate`, `endDate`), managed in [`IncomeSources.tsx`](../src/components/IncomeSources.tsx) on `/profile` and in the month dialog (`MonthlyIncomeModal`) opened from the Calendar, Week, and Pay Cycle cards.

- `countIncomeOccurrences(income, rangeStart, rangeEnd)` counts payments in an inclusive date window, using UTC calendar-date arithmetic:

| Frequency | Payments |
| :--- | :--- |
| `once` | On `startDate` only |
| `daily` | Every day from `startDate` to `endDate` |
| `weekly` | Every 7 days from `startDate` (same weekday) |
| `monthly` | On `startDate`'s day of month, clamped to the month's last day (31st → Feb 28/29, Apr 30) |
| `yearly` | On `startDate`'s month and day each year (Feb 29 → Feb 28 in common years) |

- `getMonthIncome(YYYY-MM, incomes)` returns `{ recurringIncome, oneTimeIncome, totalIncome, items }`, summing `amount × occurrences` in integer cents. Calendar, Week, Pay Cycle, and Analytics compute **Left Over = totalIncome − month (or cycle) spending** from it.
- `lib/incomeDraft.ts` validates the form (source 1–100 chars, optional name ≤ 500, positive amount with ≤ 2 decimals, real dates, end ≥ start, no end date for one-time income) and tracks unsaved changes.

---

### 1.7 Salary (Pay) Cycle Engine (`src/lib/salaryCycle.ts`)

The `/cycle` page ([`SalaryCycleView.tsx`](../src/components/SalaryCycleView.tsx)) shows spending per pay period instead of per calendar month. All computation is client-side and pure; no server API is involved.

| Setting (`SalaryCycleConfig`) | Default | Rule |
| :--- | :--- | :--- |
| `salaryDay` | `5` | Day of month, clamped to 1–28 (and to the month length). |
| `shiftWeekendToMonday` | `true` | Saturday paydays move +2 days, Sunday paydays +1 day. |
| `includeNextPaydayInCycle` | `true` | When `true`, the cycle ends **on** the next payday; when `false`, the day before. |
| `monthDelays` | `{}` | Per-month (`YYYY-MM`) adjustment in days, clamped to −7…+14; zero values are dropped. |

- **Payday**: `getPaydayForMonth` = nominal day → + weekend shift → + month delay.
- **Cycle range**: `getSalaryCycleForMonth(month)` runs from that month's actual payday to the next month's actual payday (inclusive or exclusive per setting); the end never precedes the start. It also returns Monday-first `weeks` for the grid.
- **Active cycle**: `resolveActiveCycleMonthDate(today)` returns the previous month's cycle when today is before this month's payday.
- **Totals**: cycle spending, category totals, and peak day are summed over the cycle days. Income is the anchor month's total from all income sources (`getMonthIncome(YYYY-MM, incomes)`), and `leftOver = income − cycle spending`.
- **Persistence**: `loadSalaryCycleConfig` / `saveSalaryCycleConfig` read and write `localStorage['tracker_salary_cycle_v1_<userId>']`, validating and clamping on read. The configuration is **device-local** and does not sync across browsers.
- **Data**: the view calls `fetchWeeksSpendings` for the full grid range (first Monday to last Sunday) so days that overflow into the next month are loaded. The UI provides a payday day-grid popover, a mini-calendar to pick this month's actual payday (stored as a delay), ±1-day steppers, and swipe navigation between cycles.

---

### 1.8 Scroll-Driven Calendar Window (`src/lib/calendarWindow.ts`)

`CalendarView` renders a continuously scrollable week grid (5 visible weeks) instead of a single month:
- The initial range preloads 2 months before and after the current month (`createInitialMonthRange`) and expands as the user scrolls (`expandMonthRange`).
- `getNextWeeksToFetch` compares visible weeks against the already-fetched bounds in the scroll direction; within a 4-week buffer it requests the next 3-week batch via `fetchWeeksSpendings`.
- Fetched days are revealed progressively (dates → totals/heatmap → details) to keep scrolling smooth.

---

## 2. Backend Source Code Architecture (`src/server/`)

### 2.1 Next.js Route Handlers & Layered Architecture

Backend request handling begins in Next.js dynamic Route Handlers ([`src/app/api/route.ts`](../src/app/api/route.ts) and [`src/app/api/[...slug]/route.ts`](../src/app/api/[...slug]/route.ts)), which delegate to the core application singleton ([`src/server/app.ts`](../src/server/app.ts)).

```mermaid
classDiagram
    class NextRouteHandler {
        +GET(request) Promise~Response~
        +POST(request) Promise~Response~
        +PUT(request) Promise~Response~
        +DELETE(request) Promise~Response~
        +OPTIONS(request) Promise~Response~
    }

    class ServerApp {
        +getApp() Application
        +fetch(request) Promise~Response~
        +listen(port, hostname) Server
    }

    class Application {
        +createApplication(config, authStore, financeStore?) Application
        +fetch(request) Promise~Response~
        +listen(port, hostname) Server
    }

    class Config {
        +string databaseUrl
        +string appOrigin
        +boolean production
        +parseConfig(env) Config
    }

    class AuthHttp {
        +REFRESH_COOKIE : "mf_refresh"
        +handleAuthRequest(req, subpath, body, store, config, headers) Promise~Response~
    }

    class AuthCrypto {
        +hashPassword(password) Promise~string~
        +verifyPassword(password, encoded) Promise~boolean~
        +newToken() string
        +hashToken(token) string
        +validToken(token) boolean
    }

    class AuthStore {
        <<interface>>
        +reserveAttempt(keyHash) Promise~boolean~
        +findAccount(email) Promise~Account~
        +register(name, email, passwordHash, tokens) Promise~User~
        +createSession(userId, tokens) Promise~void~
        +rotate(oldHash, tokens) Promise~User~
        +revoke(refreshHash?, accessHash?) Promise~void~
        +authenticate(accessHash) Promise~User~
    }

    class FinanceHttp {
        +handleFinanceRequest(req, subpath, url, body, authStore, financeStore, headers) Promise~Response~
    }

    class FinanceValidation {
        +settingsPatch(value) Partial~FinanceSettings~
        +spendingInput(value) SpendingInput
        +incomeInput(value) IncomeInput
        +repeatRuleInput(value) RepeatRuleInput
        +pagination(query) LimitCursor
        +uuid(value) string
    }

    class FinanceStore {
        <<interface>>
        +getSettings(userId) Promise~FinanceSettings~
        +updateSettings(userId, patch) Promise~FinanceSettings~
        +listSpendings(userId, limit, cursor?, startDate?, endDate?) Promise~SpendingPage~
        +createSpending(userId, input) Promise~Spending~
        +updateSpending(userId, id, input) Promise~Result~
        +deleteSpending(userId, id) Promise~boolean~
        +listIncomes(userId, limit, cursor?) Promise~IncomePage~
        +createIncome(userId, input) Promise~Income~
        +updateIncome(userId, id, input) Promise~Income~
        +deleteIncome(userId, id) Promise~boolean~
        +listRepeatRules(userId) Promise~RepeatRule[]~
        +createRepeatRule(userId, input) Promise~RuleAndSpendings~
        +deleteRepeatRule(userId, id, deleteFuture?) Promise~boolean~
        +syncRepeatSpendings(userId, asOfDate?) Promise~number~
    }

    class RecurrenceEngine {
        +isRuleDueForSync(rule, asOfDate) boolean
        +generateOccurrences(rule, maxBatch) GeneratedBatch
    }

    NextRouteHandler --> ServerApp
    ServerApp --> Application
    Application --> Config
    Application --> AuthHttp
    Application --> FinanceHttp
    AuthHttp --> AuthCrypto
    AuthHttp --> AuthStore
    FinanceHttp --> AuthStore : validates Bearer token
    FinanceHttp --> FinanceValidation
    FinanceHttp --> FinanceStore
    FinanceStore --> RecurrenceEngine
```

---

### 2.2 Per-User Row Locking & Concurrency Protocol (`src/server/finance/store.ts`)

Because categories are stored as a JSONB array in `finance_settings.categories`, concurrent mutations (such as deleting a category while another transaction creates a spending using it) require serialized execution per user.

[`src/server/finance/store.ts`](../src/server/finance/store.ts) executes a 3-step `ReadCommitted` transaction on every spending or settings change:
1. **`ensure(userId)`**: `INSERT INTO finance_settings (user_id, categories) VALUES ($1, $2::jsonb) ON CONFLICT (user_id) DO NOTHING` initializes default categories if needed.
2. **`lock(userId)`**: `SELECT user_id FROM finance_settings WHERE user_id = $1 FOR UPDATE` acquires an exclusive PostgreSQL row lock on that user's settings.
3. **Mutation Statement**: Executes `UPDATE finance_settings` or `INSERT/UPDATE finance_spendings ... WHERE EXISTS (SELECT 1 FROM finance_settings ...)`. Under `ReadCommitted` isolation, the query sees the freshly committed categories after waiting on the `FOR UPDATE` lock.

`deleteSpending` uses the same ensure + lock protocol. Other writes do **not** hold the lock for the whole write:
- **`createRepeatRule`** checks the category in transaction 1 (ensure + lock + `EXISTS`), then inserts the rule and its first batch of spendings in a separate transaction 2. The lock is released between them, so a concurrent category removal can slip in after the check.
- **`deleteRepeatRule`** and **income** writes do not lock settings (incomes never touch categories).

---

### 2.3 Incremental Repeat-Rule & Horizon Sync Engine (`src/server/finance/recurrence.ts`)

Recurring expenses (`daily`, `weekdays`, `weekly`, `monthly`) use bounded, horizon-driven generation ([`src/server/finance/recurrence.ts`](../src/server/finance/recurrence.ts)):

```mermaid
flowchart TD
    Trigger["Trigger: GET /spendings, GET /repeat-rules, or POST /repeat-rules/sync"]
    LoadRules["Load user's rules from finance_repeat_rules"]
    NextRule{"For each rule: isRuleDueForSync(rule, asOfDate)?"}

    CheckOcc{"endType == 'occurrences' AND occurrencesCreated >= totalOccurrences?"}
    CheckEnd{"endType == 'until_date' AND lastGeneratedDate >= endDate?"}
    CheckHorizon{"lastGeneratedDate is NULL OR (lastGeneratedDate - asOfDate) <= 14 days?"}

    Skip["Skip Rule (Up to Date)"]
    GenBatch["generateOccurrences(rule, maxBatch = 100)"]
    HasDates{"batch.dates.length > 0?"}
    AtomicTx["Execute ReadCommitted Transaction: 1. UPDATE finance_repeat_rules 2. Bulk INSERT INTO finance_spendings"]
    Done["Return sync count"]

    Trigger --> LoadRules --> NextRule
    NextRule --> CheckOcc
    CheckOcc -->|"Yes (Complete)"| Skip
    CheckOcc -->|"No"| CheckEnd
    CheckEnd -->|"Yes (Complete)"| Skip
    CheckEnd -->|"No"| CheckHorizon
    CheckHorizon -->|"No (>14 days ahead)"| Skip
    CheckHorizon -->|"Yes (Within 14-day horizon)"| GenBatch
    GenBatch --> HasDates
    HasDates -->|"No"| Skip
    HasDates -->|"Yes (1..100 dates)"| AtomicTx
    AtomicTx --> Done
    Skip --> Done
```

**Known limitation: concurrent sync.** `syncRepeatSpendings` reads rules without a row lock, and its `UPDATE finance_repeat_rules` does not check that `occurrences_created` / `last_generated_date` are unchanged. The client issues `GET /repeat-rules` (from `reload()`) and `GET /spendings` (from `fetchWeeksSpendings`) at about the same time, so two requests can generate the same batch and insert duplicate spendings for a due rule. A fix is to lock the rule (`SELECT ... FOR UPDATE`) or make the update conditional on the previously read progress values. Sync failures inside `listSpendings` / `listRepeatRules` are swallowed (`.catch(() => 0)`) so reads still succeed.
