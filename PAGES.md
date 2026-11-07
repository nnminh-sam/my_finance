# Tracker pages and deployment (Next.js App Router)

Tracker uses a unified **Next.js App Router** architecture at the repository root, combining the frontend UI and `/api/v1/*` backend Route Handlers into a single application with shared persistent layouts.

## Page manifest and App Router organization

`src/lib/pages.ts` is the source of truth for page IDs, paths, titles, and protection metadata.

| Page ID     | Public path  | App Router segment                      | Route Group | Protected |
| ----------- | ------------ | --------------------------------------- | ----------- | --------- |
| `home`      | `/`          | `src/app/page.tsx`                      | Root        | No        |
| `login`     | `/login`     | `src/app/(auth)/login/page.tsx`         | `(auth)`    | No        |
| `signup`    | `/signup`    | `src/app/(auth)/signup/page.tsx`        | `(auth)`    | No        |
| `calendar`  | `/calendar`  | `src/app/(finance)/calendar/page.tsx`   | `(finance)` | Yes       |
| `week`      | `/week`      | `src/app/(finance)/week/page.tsx`       | `(finance)` | Yes       |
| `day`       | `/day`       | `src/app/(finance)/day/page.tsx`        | `(finance)` | Yes       |
| `analytics` | `/analytics` | `src/app/(finance)/analytics/page.tsx`  | `(finance)` | Yes       |
| `plans`     | `/plans`     | `src/app/(finance)/plans/page.tsx`      | `(finance)` | Yes       |
| `profile`   | `/profile`   | `src/app/(finance)/profile/page.tsx`    | `(finance)` | Yes       |

### Layout hierarchy

1. **Root Layout (`src/app/layout.tsx`)**:
   - Configures default title (`MyFinance`), favicon (`/favicon.svg`), global stylesheets (`src/styles/globals.css`, `src/styles/navigation.css`), and JavaScript-required `<noscript>` notice.
   - Injects an inline synchronous theme initializer before hydration to prevent light/dark mode flash, and mounts `ThemeProvider` + `AuthProvider` (`src/app/providers.tsx`).
2. **Auth Route Group (`src/app/(auth)/layout.tsx`)**:
   - Wraps `/login` and `/signup`. Redirects already-authenticated users to their requested `?next=` destination (validated via `safeReturnPath`) or `/calendar`.
3. **Finance Persistent Shell (`src/app/(finance)/layout.tsx`)**:
   - Wraps `/calendar`, `/week`, `/day`, `/analytics`, and `/profile`; the header navigation shows Calendar, Week, Analytics, and Profile.
   - Redirects unauthenticated visitors to `/login?next=...`.
   - Keeps `FinanceProvider`, `SettingsProvider`, the top navigation bar, and the shared `QuickEntryDialog` / `MonthlyIncomeModal` mounted across client-side page transitions (`next/link`), avoiding redundant Neon API re-fetches when switching tabs.

## Navigation, date links, and unsaved-changes guards

Date-specific links carry the date as a query parameter, for example `/day?date=2026-10-11`, `/week?date=2026-10-11`. `readPageDate` in `src/lib/navigation.ts` parses and validates the query string. `/calendar` is the exception: it always opens on the current month, removes any `?date=` from the URL, and moves between months in memory.

Expense drafts, income forms and the month income dialog, and changed profile/settings forms register both a browser `beforeunload` warning and an in-app client-navigation confirmation guard via `useUnsavedChanges` (`src/hooks/useUnsavedChanges.ts`). Successful saves and explicit logout remove their relevant guards. Documents restored from the browser's back/forward cache (`pageshow` with `event.persisted`) reload to revalidate authentication and data.

## Plans page and budget period

`/plans` (`src/components/PlansPage.tsx`) groups its figures by the user's **budget period** instead of always using the calendar month. The page asks the server for the period summary (`GET /plans/summary`, see `FINANCE.md`) and shows:

- **Header**: `Plans · 25 Nov – 24 Dec`, the first and last day of the current period.
- **Paycheck and income lines**: in paycheck mode, one line per payday of the chosen paycheck income inside the period (date, source, amount); in the other modes, one line per income, with the count and amount when it pays more than once in the period. The **Income this period** total always includes every income paid in the period, so in paycheck mode the lines list only the paycheck income while the total can be larger.
- **Totals**: income, **Spent so far**, **Committed** (plans marked sure) and **Estimates** (the rest), then the remainder: **Left until `<next period start>`** in paycheck mode, **Left this period** in calendar and monthly-from-day modes.
- **States**: while the first response is loading the page shows a loading line; an error shows an inline message and never a zero total; a refetch keeps the previous figures until the new ones arrive, and a late response for older data is ignored. The summary reloads when plans, incomes, spendings or the budget period change.

**Spent so far** now comes from the server and covers the whole period, so it can include spendings the page used not to have loaded (the old figure depended on which months other pages had fetched). The period also follows the user's saved time zone rather than the device's local month. In calendar mode the boundaries equal the calendar month. The Plan your month guide, plan editor and income list keep calendar-month behaviour; Calendar, Week, Day, Analytics and `/cycle` are not affected by the setting.

**Profile → Paycycle → Budget period** (`src/components/BudgetPeriodSection.tsx`) edits the setting, with its own Save and Cancel, busy state and errors:

- **Mode**: Calendar month, Monthly from a start day, or Paycheck to paycheck.
- **Start day**: shown for monthly-from-day, days 1 to 28.
- **Paycheck income**: shown for paycheck mode, a select listing only weekly, twice-a-month and monthly incomes (with their schedule). With no such income a note asks to add one first, and saving paycheck mode without a chosen income is refused.
- **Locale hint**: from the browser language, falling back to the saved time zone, the section suggests Monthly from a start day for Vietnam and Japan and Paycheck to paycheck for the United States, with a **Use this** button that only fills the form. Nothing is saved until **Save**.

Income forms also gain the pay-schedule fields (every 1, 2 or 4 weeks, the two days of a twice-a-month income, and the Friday weekend shift); see `FINANCE.md`. The pay-schedule columns and the setting need migration `009_pay_schedules_and_budget_period.sql`; a branch without this change does not know twice-a-month incomes on a shared database, so avoid creating one there until this change is merged.

## Local development and production build

From the repository root:

```sh
npm run dev
```

`npm run dev` starts Next.js on port **5173** (matching the default `APP_ORIGIN=http://localhost:5173`), serving both the App Router pages and `/api/v1/*` Route Handlers from the same origin.

Build and start the production server:

```sh
npm run build
npm run start
```

`npm run build` first regenerates the HTML documentation (`npm run docs:build`) into `docs/html/` and `public/docs/`, served at `/docs`.

## Production and 404s

The root `vercel.json` configuration is:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs"
}
```

Configure deployment environment variables `DATABASE_URL` and `APP_ORIGIN` (the exact frontend HTTPS origin). Unknown routes render `src/app/not-found.tsx` with HTTP 404 status and the `Page not found · MyFinance` branding.

## Validation checklist

```sh
npm test
npm run lint
npm run build
```
