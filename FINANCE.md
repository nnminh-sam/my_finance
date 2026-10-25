# Finance persistence

Finance settings, spendings, repeat rules, and income sources are stored in Neon PostgreSQL, scoped to the user authenticated by the existing opaque bearer session. The server uses the already-installed `@neondatabase/serverless` HTTP driver. Auth cookies, refresh rotation, and auth endpoints are unchanged.

## Setup and migrations

Use Node.js 20+ and the root `.env`:

- `DATABASE_URL`: private Neon PostgreSQL connection URL, never a client environment variable.
- `APP_ORIGIN`: the exact browser origin, e.g. `http://localhost:5173` for `npm run dev`; the exact HTTPS origin for Vercel production and each preview deployment.

The app is a single Next.js project at the repository root. `npm run dev` serves pages and `/api/v1/*` on port 5173. On Vercel, `vercel.json` sets `framework: "nextjs"`; set `DATABASE_URL` and `APP_ORIGIN` as deployment variables.

From the repository root:

```sh
npm run db:migrate
npm run dev
```

The migration command (`scripts/migrate.ts`) discovers checked-in `migrations/<number>_<name>.sql` files and applies them in numeric order: `001_auth.sql`, `002_finance.sql`, `003_month_income.sql`, `004_repeat_spendings.sql`, then `005_incomes.sql`. Each file runs in its own transaction. All schema files use `CREATE TABLE/INDEX IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`, so rerunning the command safely preserves existing records. There are no destructive drops and no general migration ledger; these files are rerunnable, not a mechanism for altering an existing table definition. Future schema changes need their own ordered, rerunnable migration. The script's simple statement splitter supports these DDL files, not procedural SQL or semicolons inside literals/comments.

`002_finance.sql` adds:

- `finance_settings`: one row per user, with an `auth_users` foreign key and cascade deletion.
- `finance_spendings`: UUID-keyed spendings with an `auth_users` foreign key, exact decimal amounts, calendar dates, minute times, and a `(user_id, id)` pagination index.

`003_month_income.sql` adds `finance_income_entries` (owner-scoped, first-of-month date, amount, description). Since `005_incomes.sql` it is **legacy**: kept in the database, no longer read or written by the app.

`004_repeat_spendings.sql` adds:

- `finance_repeat_rules`: recurring spending rule configuration with frequency (`daily`, `weekdays`, `weekly`, `monthly`), interval, days of week, end type (`unlimited`, `occurrences`, `until_date`), count cap, end date, and auto-apply progress metadata (`occurrences_created`, `last_generated_date`).
- `finance_spendings.repeat_rule_id`: foreign key referencing `finance_repeat_rules(id)` with `ON DELETE SET NULL`, linking generated transactions to their source rule without cascading destructive deletes to user spending history.

`005_incomes.sql` adds:

- `finance_incomes`: one row per income source, with an `auth_users` foreign key and cascade deletion, `source` (1–100 chars), `name` (0–500 chars), positive `amount` per payment, `frequency` (`once`, `daily`, `weekly`, `monthly`, `yearly`), `start_date`, optional `end_date` (≥ start date, always `NULL` for `once`), and a `(user_id, id)` pagination index.
- A one-time copy of legacy income: `finance_settings.income > 0` becomes a monthly `Salary` / `Recurring monthly income` row (ID = user ID) starting at the earlier of the account creation month and the first month with spending; each `finance_income_entries` row becomes a one-time `Other` row (same ID, name = description) on the first day of its month. The legacy column and table are left untouched.
- `finance_income_migrations`: marks every existing user as copied, so rerunning the file never duplicates rows or restores incomes a user deleted. **Deploy the new code together with this migration**: the API no longer accepts `income` in settings, so nothing writes legacy income afterwards.

Behavior change from the old model: the recurring income used to apply to *every* month, including months before the account existed. After migration it applies from its start month onward; edit the start date of the `Salary` income on `/profile` if earlier months should include it.

Settings rows are created lazily on settings reads/writes or spending writes. Avatar starts as `''`. Income, base daily spending, and maximum daily spending are no longer settings. Their legacy database columns are preserved but ignored, so their removal requires no destructive migration and does not discard existing data. The six categories use the existing client IDs, colors, and icons:

| ID/name       | Color     | Icon               |
| ------------- | --------- | ------------------ |
| Food          | `#10b981` | `Utensils`         |
| Transport     | `#3b82f6` | `Car`              |
| Entertainment | `#8b5cf6` | `Film`             |
| Shopping      | `#f59e0b` | `ShoppingBag`      |
| Bills         | `#ef4444` | `Receipt`          |
| Other         | `#6b7280` | `CircleDollarSign` |

No expenses are seeded. Existing localStorage or mock client records are **not imported** by migrations or by the API. Any intentional import must be a separate authenticated workflow. Client profile name/email and light/dark theme remain separate from finance settings.

## Client behavior

The login and sign-up screens expose a light/dark toggle. Appearance follows the system until explicitly selected, persists under `tracker_theme`, and is available before session restoration finishes.

All finance views load real records through `FinanceContext` and the authenticated API client. The initial load fetches settings, incomes, and repeat rules; spendings are fetched per date range (`startDate`/`endDate`) as pages and the calendar need them, then merged by ID. Pagination is followed until `nextCursor` is null. Initial load errors show a retry/sign-out screen, not a misleading empty dataset; later refresh failures retain the last successfully loaded records with a warning. Reloads and writes are serialized so an older GET cannot overwrite a saved expense. Records refresh on window focus or the header refresh button.

Use the header **Add expense** button on any finance page, or the **Add expense** button in day details, to open a modal without navigating. Each new modal defaults to the current local date and time at opening—even when viewing a historical day—and both fields are editable. Editing a transaction uses the same modal with its existing values. Cancel/Escape confirm before discarding changed fields; pending saves cannot be dismissed. Validation or API failures keep the modal and entered values available. Save/edit/delete operations wait for the server response. Personalized settings live on `/profile`, with independent income-source, avatar, categories, and appearance editors. Click a section's heading/Edit control to edit it; each has its own Save/Cancel, busy state, and errors. Income sources, avatar, and categories persist in Neon; appearance remains device-local. Name and email stay read-only. Empty accounts show no transactions and no income; only category definitions are supplied as defaults. Theme, auth coordination metadata, and the salary cycle configuration are the only app data persisted in browser storage.

Calendar/week heatmaps show relative spending intensity against the selected month's highest daily total, not budget compliance. Analytics reference monthly income only when the month has any, omit daily-limit lines/classifications, and show active/no-spend days and no-spend streaks.

## Income sources

A user can have any number of income sources: a 9–5 salary, freelance clients, a parent's allowance, gifts, dividends, and so on. Each has:

| Field | Rule |
| ----- | ---- |
| Source | Required, 1–100 characters (suggestions: Salary, Freelance, Bonus, Allowance, Gift, Investment, Other; any text is allowed) |
| Name | Optional, up to 500 characters (e.g. employer, client, or person) |
| Amount | Paid **per payment**: positive, up to 1,000,000,000,000 ₫, at most two decimals |
| Frequency | `once`, `daily`, `weekly`, `monthly`, or `yearly` |
| Start date | The first payment (the only one for `once`) |
| End date | Optional, inclusive, not before the start date; not allowed for `once` |

**Payments per month:** one-time income counts in the month of its date; daily income counts every day in the period; weekly income repeats every 7 days on the start date's weekday (4 or 5 times a month); monthly income pays on the start date's day of the month, moved to the last day in shorter months (a 31st salary pays Feb 28/29 and Apr 30); yearly income pays once a year on the start month and day (Feb 29 → Feb 28 in common years).

**Month income = Σ amount × payments in that month**, summed in exact cents (`src/lib/income.ts`). For example, a 20,000,000 ₫ monthly salary, a 1,000,000 ₫ weekly part-time wage starting Monday 2026-10-05, and a 5,000,000 ₫ one-time bonus on 2026-10-20 give October 2026: 20,000,000 + 4 × 1,000,000 + 5,000,000 = 29,000,000 ₫.

Where it is used:

- `/profile` → **Income sources**: pick a month to see recurring, one-time, and total income for it, list every source with its schedule and what it pays in that month, and add, edit, or delete sources.
- Calendar, Week, and Pay Cycle overview cards show **Income**, **Spending**, and **Left Over = income − spending** for the month (the pay cycle uses its anchor month's income), with a recurring / one-time breakdown. Their **Edit** button opens a dialog listing that month's income with an add form whose date defaults to that month.
- Analytics use the month income for the income reference line, projected savings, and overspending insights.

Forms confirm before discarding changes, block closing while saving, keep drafts on validation or server errors, and take part in the profile's leave-page and logout guards.

## Salary (pay) cycle view

`/cycle` groups spending by pay period instead of calendar month. It is computed in the browser (`src/lib/salaryCycle.ts`) from existing spendings and income; there is no server API or table for it.

- **Payday**: configurable day 1–28 (default 5), clamped to the month length. With **shift weekend to Monday** (default on), Saturday paydays move to Monday (+2) and Sunday paydays to Monday (+1).
- **Per-month adjustment**: a delay or early payout of −7…+14 days for a specific month, set with a mini-calendar or ±1-day buttons, and resettable.
- **Cycle range**: from this month's actual payday to next month's actual payday, including that payday by default (**include next payday in cycle**), or ending the day before when turned off.
- **Totals**: cycle spending, top categories, and peak day across the cycle days; income for the cycle's anchor month (all income sources' payments in that `YYYY-MM`); leftover = income − cycle spending.
- **Storage**: the configuration is saved in `localStorage` under `tracker_salary_cycle_v1_<userId>`. It is per device and browser and is not synced through Neon.

## API

All routes below are under `/api/v1/finance` and require:

```http
Authorization: Bearer <opaque access token>
```

Write requests additionally require `Origin` equal to `APP_ORIGIN` and JSON bodies where applicable. Browser clients use the existing auth refresh endpoint to obtain a fresh bearer token when needed.

| Method | Route                                     | Body                                                  | Success                                        |
| ------ | ----------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| GET    | `/settings`                               | —                                                     | `200 {settings}`                               |
| PUT    | `/settings`                               | Any subset of finance settings fields, or all of them | `200 {settings}`                               |
| GET    | `/spendings?limit=500&cursor=<uuid>&startDate=<date>&endDate=<date>` | —                          | `200 {spendings, nextCursor}`                  |
| POST   | `/spendings`                              | Full spending input                                   | `201 {spending}`                               |
| PUT    | `/spendings/:id`                          | Full spending input                                   | `200 {spending}`                               |
| DELETE | `/spendings/:id`                          | —                                                     | `204`, empty body                              |
| GET    | `/incomes?limit=500&cursor=<uuid>`        | —                                                     | `200 {incomes, nextCursor}`                    |
| POST   | `/incomes`                                | Income input                                          | `201 {income}`                                 |
| PUT    | `/incomes/:id`                            | Full income input                                     | `200 {income}`                                 |
| DELETE | `/incomes/:id`                            | —                                                     | `204`, empty body                              |
| GET    | `/repeat-rules`                           | —                                                     | `200 {repeatRules}`                            |
| POST   | `/repeat-rules`                           | Full repeat rule input                                | `201 {repeatRule, spendings}`                  |
| DELETE | `/repeat-rules/:id?deleteFuture=true`     | —                                                     | `204`, empty body                              |
| POST   | `/repeat-rules/sync`                      | `{asOfDate?}`                                         | `200 {spendingsCreated}`                       |

Settings shape:

```json
{
  "settings": {
    "avatar": "",
    "categories": [
      { "id": "Food", "name": "Food", "color": "#10b981", "icon": "Utensils" }
    ]
  }
}
```

The example abbreviates the categories; defaults contain all six listed above. PUT merges provided scalar fields and replaces the entire category array when provided. An empty object is a no-op; an empty category array is allowed. Responses contain only the active finance settings: `avatar` and `categories`. Requests containing the removed `income`, `baseDailySpending`, or `maxDailySpending` fields return `400`; manage income through `/incomes`. The old `/income-entries` routes were removed and return `404`.

Spending input (the response adds a server-generated UUID `id`):

```json
{
  "amount": 12.34,
  "description": "Lunch",
  "category": "Food",
  "date": "2026-10-11",
  "time": "12:05"
}
```

Validation:

- Money must be a finite JSON number, at most `1000000000000`, with at most two decimal places. Spending and income amounts must be positive. Responses return numbers, not PostgreSQL numeric strings.
- Category IDs and names are nonblank strings of at most 100 characters; IDs are unique within settings, with at most 50 categories. Colors must be six-digit hexadecimal `#RRGGBB` values.
- Allowed icons: `Utensils`, `Car`, `Film`, `ShoppingBag`, `Receipt`, `CircleDollarSign`, `Coffee`, `Home`, `Heart`, `Briefcase`, `Gift`, `Phone`.
- Avatar is `''` or an absolute HTTP(S) URL, at most 2048 characters, without URL credentials. No data/javascript/custom schemes. The server stores the URL but does not fetch it. Rendering it on the client can contact its remote host.
- Description is a string of at most 1000 characters (empty allowed). Category is a nonblank string of at most 100 characters. These strings and settings strings reject control characters.
- Date is an actual Gregorian date in `YYYY-MM-DD`, years `0001`–`9999`, including leap-year checks. Time is exactly `HH:mm`, `00:00`–`23:59`; neither is converted through a timezone.
- Unknown body fields are rejected, including caller-supplied ownership IDs, profile fields, or expense IDs. Missing required spending fields and `null` settings values are rejected.
- JSON request bodies are limited to 128 KB for finance routes (auth retains its existing 16 KB limit).
- Invalid bodies, IDs, query limits/cursors, or categories return `400`; invalid/missing bearer sessions return `401`; disallowed/missing write origins return `403`; missing or another user's spending ID returns `404`; oversized JSON returns `413`; database failures return a generic `503` without private database details.

### Repeat spending rules and incremental auto-apply tracking

Users can configure repeat spendings (breakfast, lunch, coffee, gas, rent, etc.) via the Add Expense modal or by selecting one of the Quick Repeat presets.

- **Frequencies**: `daily`, `weekdays` (Monday through Friday), `weekly` (with arbitrary multi-day selections such as Mon/Wed/Fri), and `monthly` (with calendar end-of-month and leap-year clamping).
- **Duration / End Types**:
  - `unlimited`: No end date or fixed count specified. Generates an initial window capped at 100 occurrences.
  - `occurrences`: Repeat for an exact count (1 to 100 maximum cap).
  - `until_date`: Repeat until a specific calendar cutoff date (generates occurrences up to that date, capped at 100 per cycle).
- **100-Repeat Safety Cap**:
  Every generation cycle strictly caps spending creation at 100 entries per batch to prevent denial of service and runaway table bloat.
- **Incremental Repeat Auto-Apply Tracking**:
  Since infinite transactions cannot be written ahead of time, the server tracks each rule's `occurrences_created` and `last_generated_date`. When a rule's horizon is within 14 days of the evaluated date (`last_generated_date <= today + 14 days`), the backend's `syncRepeatSpendings` engine automatically calculates and generates the next incremental batch of occurrences (capped at 100 per batch).
- **Automatic Horizon Sync**:
  Calls to `GET /spendings` and `GET /repeat-rules` automatically evaluate and sync due rules before returning data. This ensures that when an unlimited rule is active, recurring transactions appear on the user's calendar seamlessly without requiring manual re-application.
- **Rule Lifecycle**:
  Active rules are listed on the user's `/profile` page under **Repeat spendings**, displaying frequency, progress, and latest generated date. Stopping a rule (`DELETE /repeat-rules/:id?deleteFuture=true`) deletes upcoming future spendings while preserving historical past transactions for financial record accuracy.

### Income validation and ownership

Income input (the response adds a server-generated UUID `id`; `name` defaults to `""` and `endDate` to `null` when omitted):

```json
{
  "source": "Salary",
  "name": "Company",
  "amount": 20000000,
  "frequency": "monthly",
  "startDate": "2026-01-05",
  "endDate": null
}
```

`source` and `name` are trimmed; `source` must be nonblank and at most 100 characters, `name` at most 500; neither may contain control characters. `frequency` must be one of `once`, `daily`, `weekly`, `monthly`, `yearly`. `startDate` and `endDate` are real `YYYY-MM-DD` dates (years `0001`–`9999`) without timezone conversion; `endDate` must not precede `startDate` and must be absent or `null` for `once`. Unknown fields, including ownership IDs, are rejected. Mutations use both the income ID and the authenticated user ID. Malformed, missing, and other-user income IDs receive `404`; invalid bodies or query pagination receive `400`. Income writes never lock or change settings.

### Pagination

Spendings and incomes are sorted by **UUID ascending**, not by date or creation time. `GET /spendings` also accepts optional `startDate` and `endDate` (`YYYY-MM-DD`, inclusive; `endDate` must not precede `startDate`) to restrict results to a date window; the cursor rules below apply unchanged within that window. `limit` defaults to 500 and must be an integer from 1 to 500. The API reads one extra row to determine whether another page exists. `nextCursor` is the final returned ID if more rows exist, otherwise `null`. Pass it unchanged as the next request's `cursor`, and continue until `null` to retrieve the complete dataset. A UUID cursor is a value boundary, not a record lookup, so deleting its record does not invalidate it.

Pagination is not a multi-request snapshot: concurrent inserts with UUIDs before an already-read boundary will not appear in that traversal. For a fresh complete view, start again without a cursor. Existing unchanged rows are never offset-skipped. Dates do not affect pagination order.

## Security and category changes

Every store operation receives only the user ID returned by `authenticateRequest` in `src/server/auth/http.ts`. Caller-supplied query ownership IDs have no effect; unknown body fields are rejected rather than trusted. Both the expense/income ID and authenticated user ID are required in mutation SQL predicates. Finance responses use `Cache-Control: no-store`. Cookie-only finance requests are not authenticated. Existing strict origin/CSRF protection covers POST, PUT, and DELETE; CORS now advertises PUT and DELETE as well.

Category IDs on expenses are historical values, not foreign keys to the mutable settings list. Removing a category does not delete or rewrite old expenses; clients should display an unknown-category fallback. Creating or updating an expense requires its category ID to exist in the user's **current** settings, including lazily persisted defaults. A full update to an expense whose category was removed must choose an existing category first. Deleting a historical expense is still allowed.

Settings and spending mutations serialize on the per-user settings row inside a Neon transaction. Category validation and the expense write execute in a separate statement **after** acquiring that lock, at explicit READ COMMITTED isolation, so a waiting writer sees settings committed by the preceding writer. Concurrent partial settings updates retain each other's unrelated fields. All application category/settings writes must continue using this store/lock protocol; direct manual SQL writes are outside the API guarantee.

`createApplication(config, authStore, financeStore?)` keeps existing two-argument auth tests compatible and allows finance tests to inject a store. Two-argument applications intentionally do not mount finance routes. Production `src/server/app.ts` always creates and injects the Neon finance store.

## Validation commands

```sh
npm run lint
npm test
npm run build
```

Client `test/finance.test.ts` checks complete pagination, server-authoritative CRUD, and failed requests; `test/spendings.test.ts` verifies empty-data and controlled-data totals/analytics; `test/salary-cycle.test.ts` covers pay cycle calculations.

`test/finance-http.test.ts` uses injectable stores to cover authenticated routes, origin/CORS behavior, defaults, partial/full settings, isolation, CRUD, historical category handling, validation, and pagination across more than 500 records.

Optional real Neon tests use an **isolated, already-migrated test database**:

```sh
DATABASE_URL="$FINANCE_TEST_DATABASE_URL" npm run db:migrate
FINANCE_TEST_DATABASE_URL='postgresql://…' npm test
```

Set `FINANCE_TEST_DATABASE_URL` privately before running the first command. These tests are skipped when it is absent. They check cross-worker persistence, partial-update merging, ownership predicates, decimal/date/time serialization, full pagination, and a real category-lock race. Tests create synthetic fixtures and delete their own users (cascading finance records); they are not production import/seed code. The concurrency test observes `pg_stat_activity`/`pg_blocking_pids` for its own database role and uses an eight-second lock holder. Never point tests at a live finance database.
