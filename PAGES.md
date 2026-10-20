# Tracker pages and deployment (Next.js App Router)

Tracker uses a unified **Next.js App Router** architecture at the repository root, combining the frontend UI and `/api/v1/*` backend Route Handlers into a single application with shared persistent layouts.

## Page manifest and App Router organization

`src/pages.ts` is the source of truth for page IDs, paths, titles, and protection metadata.

| Page ID     | Public path  | App Router segment                      | Route Group | Protected |
| ----------- | ------------ | --------------------------------------- | ----------- | --------- |
| `home`      | `/`          | `src/app/page.tsx`                      | Root        | No        |
| `login`     | `/login`     | `src/app/(auth)/login/page.tsx`         | `(auth)`    | No        |
| `signup`    | `/signup`    | `src/app/(auth)/signup/page.tsx`        | `(auth)`    | No        |
| `calendar`  | `/calendar`  | `src/app/(finance)/calendar/page.tsx`   | `(finance)` | Yes       |
| `cycle`     | `/cycle`     | `src/app/(finance)/cycle/page.tsx`      | `(finance)` | Yes       |
| `week`      | `/week`      | `src/app/(finance)/week/page.tsx`       | `(finance)` | Yes       |
| `day`       | `/day`       | `src/app/(finance)/day/page.tsx`        | `(finance)` | Yes       |
| `analytics` | `/analytics` | `src/app/(finance)/analytics/page.tsx`  | `(finance)` | Yes       |
| `profile`   | `/profile`   | `src/app/(finance)/profile/page.tsx`    | `(finance)` | Yes       |

### Layout hierarchy

1. **Root Layout (`src/app/layout.tsx`)**:
   - Configures default title (`MyFinance`), favicon (`/favicon.svg`), global stylesheets (`src/index.css`, `src/navigation.css`), and JavaScript-required `<noscript>` notice.
   - Injects an inline synchronous theme initializer before hydration to prevent light/dark mode flash, and mounts `ThemeProvider` + `AuthProvider` (`src/app/providers.tsx`).
2. **Auth Route Group (`src/app/(auth)/layout.tsx`)**:
   - Wraps `/login` and `/signup`. Redirects already-authenticated users to their requested `?next=` destination (validated via `safeReturnPath`) or `/calendar`.
3. **Finance Persistent Shell (`src/app/(finance)/layout.tsx`)**:
   - Wraps `/calendar`, `/week`, `/day`, `/analytics`, and `/profile`.
   - Redirects unauthenticated visitors to `/login?next=...`.
   - Keeps `FinanceProvider`, `SettingsProvider`, the top navigation bar, and the shared `ExpenseModal` / `MonthlyIncomeModal` mounted across client-side page transitions (`next/link`), avoiding redundant Neon API re-fetches when switching tabs.

## Navigation, date links, and unsaved-changes guards

Date-specific links carry the date as a query parameter, for example `/day?date=2026-10-11`, `/week?date=2026-10-11`, or `/calendar?date=2026-10-11`. `readPageDate` in `src/navigation.ts` parses and validates the query string.

Expense drafts, additional-income modals, and changed profile/settings forms register both a browser `beforeunload` warning and an in-app client-navigation confirmation guard via `useUnsavedChanges` (`src/useUnsavedChanges.ts`). Successful saves and explicit logout remove their relevant guards. Documents restored from the browser's back/forward cache (`pageshow` with `event.persisted`) reload to revalidate authentication and data.

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
