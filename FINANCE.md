# Finance persistence

Finance settings, spendings, and month-specific additional income are stored in Neon PostgreSQL, scoped to the user authenticated by the existing opaque bearer session. The server uses the already-installed `@neondatabase/serverless` HTTP driver. Auth cookies, refresh rotation, and auth endpoints are unchanged.

## Setup and migrations

Use Node.js 20+ and the existing root/server environment setup:

- `DATABASE_URL`: private Neon PostgreSQL connection URL, never a client environment variable.
- `APP_ORIGIN`: the exact browser origin, e.g. `http://localhost:5173` for standalone Vite; the exact frontend HTTPS origin for Vercel production and each preview deployment.

Vercel uses the root `vercel.json` services described in `PAGES.md`: a public static Vite client for non-API paths and a public Express server for `/api/*`, entered through `packages/server/src/app.ts`. Set the project Root Directory to the repository root and clear legacy top-level/dashboard build and output overrides. `packages/shared` is empty and neither app imports it; it is not a shared library dependency or a service, and no shared-source inclusion setting is currently needed. Set shared `DATABASE_URL` and `APP_ORIGIN` deployment variables, leave `PORT` unset, and normally let Vercel supply `NODE_ENV`. There are no internal runtime service calls, so no bindings are needed. Never expose credentials or runtime binding values through `VITE_*` variables.

Standalone root `npm run dev` uses client port 5173 and server port 4000, with Vite proxying `/api` to localhost:4000. For local service-routing checks, run `vercel dev` from the repository root and set `APP_ORIGIN` to the actual browser origin, e.g. `http://localhost:3000`. Vite disables the localhost proxy when `VERCEL=1` because platform routing handles API requests. `VERCEL_ENV=development` is treated as nonproduction unless `NODE_ENV=production` is explicit; production/preview require HTTPS and Secure cookies.

From the repository root:

```sh
npm run db:migrate --workspace=@my-finance/server
npm run build --workspace=@my-finance/server
npm run dev --workspace=@my-finance/server
```

The migration command discovers checked-in `packages/server/migrations/<number>_<name>.sql` files and applies them in numeric order: `001_auth.sql`, `002_finance.sql`, then `003_month_income.sql`. Each file runs in its own transaction. All three schema files use `CREATE TABLE/INDEX IF NOT EXISTS`, so rerunning the command safely preserves existing records. There are no destructive drops and no migration ledger; these initial files are rerunnable, not a mechanism for altering an existing table definition. Future schema changes need their own ordered, rerunnable migration. The script's simple statement splitter supports these DDL files, not procedural SQL or semicolons inside literals/comments.

`002_finance.sql` adds:

- `finance_settings`: one row per user, with an `auth_users` foreign key and cascade deletion.
- `finance_spendings`: UUID-keyed spendings with an `auth_users` foreign key, exact decimal amounts, calendar dates, minute times, and a `(user_id, id)` pagination index.

`003_month_income.sql` adds `finance_income_entries`: owner-scoped UUID records, a first-of-month calendar date, an exact decimal amount, and a description. It has user/ID and user/month indexes. **Run the migration command before using additional income**; the initial client load now fetches income entries too, so an unapplied migration produces a load error rather than silently ignoring bonuses. No income entries are seeded; existing recurring income and expenses are preserved.

Settings rows are created lazily on settings reads/writes or spending writes. Monthly income starts at **0**; avatar starts as `''`. Base and maximum daily spending are no longer active settings. Their legacy database columns are preserved but ignored, so their removal requires no destructive migration and does not discard existing income or expenses. The six categories use the existing client IDs, colors, and icons:

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

All finance views load real records through `FinanceContext` and the authenticated API client. Pagination is followed until `nextCursor` is null. Initial load errors show a retry/sign-out screen, not a misleading empty dataset; later refresh failures retain the last successfully loaded records with a warning. Reloads and writes are serialized so an older GET cannot overwrite a saved expense. Records refresh on window focus or the header refresh button.

Use the header **Add expense** button on any finance page, or the **Add expense** button in day details, to open a modal without navigating. Each new modal defaults to the current local date and time at opening—even when viewing a historical day—and both fields are editable. Editing a transaction uses the same modal with its existing values. Cancel/Escape confirm before discarding changed fields; pending saves cannot be dismissed. Validation or API failures keep the modal and entered values available. Save/edit/delete operations wait for the server response. Personalized settings live on `/profile`, with independent monthly-income, avatar, categories, and appearance editors. Click a section's heading/Edit control to edit it; each has its own Save/Cancel, busy state, and errors. Monthly income accepts zero and up to two decimal places and saves only the income field to Neon. Avatar and categories also persist in Neon; appearance remains device-local. Name and email stay read-only. Empty accounts show no transactions and zero financial settings; only category definitions are supplied as defaults. Theme and auth coordination metadata are the only app preferences persisted in browser storage.

Calendar/week heatmaps show relative spending intensity against the selected month's highest daily total, not budget compliance. Analytics reference monthly income only when set, omit daily-limit lines/classifications, and show active/no-spend days and no-spend streaks.

## Month-specific additional income

On `/profile`, keep **Recurring monthly income** as the default amount for every month. The independent **Additional income by month** section lets you choose a month and year, add multiple labeled payments (e.g. a performance bonus), and edit/delete each record. New entries default to the currently selected month; changing an entry's month moves only that record. Drafts survive validation/server errors; changed drafts and pending writes participate in the profile's leave-page and logout guards.

Calendar and week overview cards also provide an **Edit** button beside **Monthly Income**. It opens a modal with a new additional-income form for the displayed month and year, including historical or future months. The month is fixed in this shortcut; recurring income remains unchanged. You can add, edit, or delete that month's additional entries without leaving the overview, and saved changes update the totals immediately through the shared finance context. The dialog supports light/dark themes, confirms before discarding changed fields, blocks dismissal during pending writes, and retains drafts on validation/server errors.

**Selected-month income = recurring monthly income + sum of additional income entries for that exact month and year.** For example, recurring income of 20,000,000 ₫ and an October 2026 bonus of 5,000,000 ₫ gives October 25,000,000 ₫; November remains 20,000,000 ₫. Additional entries are not overrides, do not recur, and are not spending records. Editing the recurring setting continues to change the base for all months, as before.

Calendar and week monthly totals/leftovers and analytics income references, projected savings, and overspending insights use this effective amount. Breakdowns distinguish recurring and additional income, including when the recurring amount is zero.

## API

All routes below are under `/api/v1/finance` and require:

```http
Authorization: Bearer <opaque access token>
```

Write requests additionally require `Origin` equal to `APP_ORIGIN` and JSON bodies where applicable. Browser clients use the existing auth refresh endpoint to obtain a fresh bearer token when needed.

| Method | Route                                     | Body                                                  | Success                           |
| ------ | ----------------------------------------- | ----------------------------------------------------- | --------------------------------- |
| GET    | `/settings`                               | —                                                     | `200 {settings}`                  |
| PUT    | `/settings`                               | Any subset of finance settings fields, or all of them | `200 {settings}`                  |
| GET    | `/spendings?limit=500&cursor=<uuid>`      | —                                                     | `200 {spendings, nextCursor}`     |
| POST   | `/spendings`                              | Full spending input                                   | `201 {spending}`                  |
| PUT    | `/spendings/:id`                          | Full spending input                                   | `200 {spending}`                  |
| DELETE | `/spendings/:id`                          | —                                                     | `204`, empty body                 |
| GET    | `/income-entries?limit=500&cursor=<uuid>` | —                                                     | `200 {incomeEntries, nextCursor}` |
| POST   | `/income-entries`                         | `{month, amount, description}`                        | `201 {incomeEntry}`               |
| PUT    | `/income-entries/:id`                     | Full `{month, amount, description}`                   | `200 {incomeEntry}`               |
| DELETE | `/income-entries/:id`                     | —                                                     | `204`, empty body                 |

Settings shape:

```json
{
  "settings": {
    "income": 0,

    "avatar": "",
    "categories": [
      { "id": "Food", "name": "Food", "color": "#10b981", "icon": "Utensils" }
    ]
  }
}
```

The example abbreviates the categories; defaults contain all six listed above. PUT merges provided scalar fields and replaces the entire category array when provided. An empty object is a no-op; an empty category array is allowed. Responses contain only the active finance settings: `income`, `avatar`, and `categories`. Requests containing the removed `baseDailySpending` or `maxDailySpending` fields return `400`; callers should stop sending them.

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

- Money must be a finite JSON number, at most `1000000000000`, with at most two decimal places. Settings allow zero; spending amounts must be positive. Responses return numbers, not PostgreSQL numeric strings.
- Category IDs and names are nonblank strings of at most 100 characters; IDs are unique within settings, with at most 50 categories. Colors must be six-digit hexadecimal `#RRGGBB` values.
- Allowed icons: `Utensils`, `Car`, `Film`, `ShoppingBag`, `Receipt`, `CircleDollarSign`, `Coffee`, `Home`, `Heart`, `Briefcase`, `Gift`, `Phone`.
- Avatar is `''` or an absolute HTTP(S) URL, at most 2048 characters, without URL credentials. No data/javascript/custom schemes. The server stores the URL but does not fetch it. Rendering it on the client can contact its remote host.
- Description is a string of at most 1000 characters (empty allowed). Category is a nonblank string of at most 100 characters. These strings and settings strings reject control characters.
- Date is an actual Gregorian date in `YYYY-MM-DD`, years `0001`–`9999`, including leap-year checks. Time is exactly `HH:mm`, `00:00`–`23:59`; neither is converted through a timezone.
- Unknown body fields are rejected, including caller-supplied ownership IDs, profile fields, or expense IDs. Missing required spending fields and `null` settings values are rejected.
- JSON request bodies are limited to 128 KB for finance routes (auth retains its existing 16 KB limit).
- Invalid bodies, IDs, query limits/cursors, or categories return `400`; invalid/missing bearer sessions return `401`; disallowed/missing write origins return `403`; missing or another user's spending ID returns `404`; oversized JSON returns `413`; database failures return a generic `503` without private database details.

### Income entry validation and ownership

Income entries are `{id, month: "YYYY-MM", amount, description}`. Months must have years `0001`–`9999` and months `01`–`12`; they are stored without timezone conversion. Amounts must be positive, finite, at most `1e12`, and have at most two decimal places. Descriptions are trimmed, nonblank, at most 500 characters, and cannot contain controls. Unknown fields, including ownership IDs, are rejected. Income entry mutations use both the entry ID and authenticated user ID. Malformed, missing, and other-user entry IDs receive `404`; invalid bodies/query pagination receive `400`. These independent writes never overwrite recurring settings or lock category settings.

### Pagination

Spendings and income entries are sorted by **UUID ascending**, not by date or creation time. `limit` defaults to 500 and must be an integer from 1 to 500. The API reads one extra row to determine whether another page exists. `nextCursor` is the final returned ID if more rows exist, otherwise `null`. Pass it unchanged as the next request's `cursor`, and continue until `null` to retrieve the complete dataset. A UUID cursor is a value boundary, not a record lookup, so deleting its record does not invalidate it.

Pagination is not a multi-request snapshot: concurrent inserts with UUIDs before an already-read boundary will not appear in that traversal. For a fresh complete view, start again without a cursor. Existing unchanged rows are never offset-skipped. Dates do not affect pagination order.

## Security and category changes

Every store operation receives only `res.locals.user.id` from `requireAuth` in `src/auth/http.ts`. Caller-supplied query ownership IDs have no effect; unknown body fields are rejected rather than trusted. Both the expense/income-entry ID and authenticated user ID are required in mutation SQL predicates. Finance responses use `Cache-Control: no-store`. Cookie-only finance requests are not authenticated. Existing strict origin/CSRF protection covers POST, PUT, and DELETE; CORS now advertises PUT and DELETE as well.

Category IDs on expenses are historical values, not foreign keys to the mutable settings list. Removing a category does not delete or rewrite old expenses; clients should display an unknown-category fallback. Creating or updating an expense requires its category ID to exist in the user's **current** settings, including lazily persisted defaults. A full update to an expense whose category was removed must choose an existing category first. Deleting a historical expense is still allowed.

Settings and spending mutations serialize on the per-user settings row inside a Neon transaction. Category validation and the expense write execute in a separate statement **after** acquiring that lock, at explicit READ COMMITTED isolation, so a waiting writer sees settings committed by the preceding writer. Concurrent partial settings updates retain each other's unrelated fields. All application category/settings writes must continue using this store/lock protocol; direct manual SQL writes are outside the API guarantee.

`createApplication(config, authStore, financeStore?)` keeps existing two-argument auth tests compatible and allows finance tests to inject a store. Two-argument applications intentionally do not mount finance routes. Production `src/app.ts` always creates and injects the Neon finance store.

## Validation commands

```sh
npm test --workspace=@my-finance/server
npm run build --workspace=@my-finance/server
npm test --workspace=@my-finance/client
npm run build
```

Client `test/finance.test.ts` checks complete pagination, server-authoritative CRUD, and failed requests; `test/spendings.test.ts` verifies empty-data and controlled-data totals/analytics. No CLI commands, tests, builds, or migrations were executed for this documentation update because no terminal is available; editor diagnostics are static validation only.

`test/finance-http.test.ts` uses injectable stores to cover authenticated routes, origin/CORS behavior, defaults, partial/full settings, isolation, CRUD, historical category handling, validation, and pagination across more than 500 records.

Optional real Neon tests use an **isolated, already-migrated test database**:

```sh
DATABASE_URL="$FINANCE_TEST_DATABASE_URL" npm run db:migrate --workspace=@my-finance/server
FINANCE_TEST_DATABASE_URL='postgresql://…' npm test --workspace=@my-finance/server
```

Set `FINANCE_TEST_DATABASE_URL` privately before running the first command. These tests are skipped when it is absent. They check cross-worker persistence, partial-update merging, ownership predicates, decimal/date/time serialization, full pagination, and a real category-lock race. Tests create synthetic fixtures and delete their own users (cascading finance records); they are not production import/seed code. The concurrency test observes `pg_stat_activity`/`pg_blocking_pids` for its own database role and uses an eight-second lock holder. Never point tests at a live finance database.
