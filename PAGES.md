# Tracker pages and deployment

Tracker uses a multi-page application (MPA): each page is a real HTML document, not a client-side React Router route. Each entry loads `/src/main.tsx` and identifies its page with `#root[data-page]`. Navigation between pages loads a new document, including on direct links and refreshes.

## Page manifest

`packages/client/src/pages.ts` is the source of truth for page IDs, paths, HTML filenames, titles, and protection metadata.

| Page ID     | Public path  | HTML entry       | Protected |
| ----------- | ------------ | ---------------- | --------- |
| `home`      | `/`          | `index.html`     | No        |
| `login`     | `/login`     | `login.html`     | No        |
| `signup`    | `/signup`    | `signup.html`    | No        |
| `calendar`  | `/calendar`  | `calendar.html`  | Yes       |
| `week`      | `/week`      | `week.html`      | Yes       |
| `day`       | `/day`       | `day.html`       | Yes       |
| `analytics` | `/analytics` | `analytics.html` | Yes       |
| `profile`   | `/profile`   | `profile.html`   | Yes       |

Vite derives all build inputs and local pretty-route rewrites from the manifest, using paths relative to `vite.config.ts`, not the invoking process's working directory. HTML titles are also synchronized from the manifest during Vite's HTML transformation. Each physical entry includes its matching title, favicon, charset, viewport, and JavaScript-required fallback.

When adding or renaming a page, update the manifest, create/update its physical HTML entry and `data-page` value, and keep the explicit rewrites in root `vercel.json` aligned. Vercel's static JSON configuration cannot import the TypeScript manifest.

## Navigation and date links

Use normal document links for navigation, rather than SPA history routing. Date-specific links carry the date as a query parameter, for example `/day?date=2026-10-11`, `/week?date=2026-10-11`, or `/calendar?date=2026-10-11`. Routing preserves the query string verbatim; interpreting and validating the date belongs to the page code, not the deployment middleware.

Moving to another page reloads the document and resets in-memory React state. Expense drafts and changed profile/settings forms register a browser leave-page warning; browsers control whether to show it, so save changes before navigating. Successful saves and explicit logout remove their relevant guards. Documents restored from the browser's back/forward cache reload to revalidate authentication and data, rather than displaying a stale authenticated screen after logout.

## Local development and preview

From the repository root:

```sh
npm run dev
# Client only (start the API separately if needed):
npm run dev:client
```

The client development server uses port 5173 and proxies `/api` to `http://localhost:4000`. The Vite page-routing plugin runs before internal middleware in both development and preview. It maps only manifest paths (also accepting a single trailing slash), preserves query strings, and does not redirect assets or API requests into page documents.

Build and preview the production output:

```sh
npm run build --workspace=@my-finance/client
npm run preview --workspace=@my-finance/client
```

Preview serves the built files with the same pretty-page routing on port **5173**, matching the default API `APP_ORIGIN`. Stop the client dev server before starting preview. Both dev and preview use strict ports rather than silently switching to an origin the API would reject. Vite preview inherits the development `/api` proxy, so API calls still need a separate API server at `http://localhost:4000`. If choosing a different client port, update the API's `APP_ORIGIN` to match and restart it. Preview is not a replacement for the production API deployment.

## Production and 404s

Vite sets `appType: 'mpa'` and builds all eight physical HTML entries into `packages/client/dist`, with shared hashed assets. Vercel runs the client workspace build and publishes that directory.

In `vercel.json`, the `/api/(.*)` rewrite remains first and targets `/api/index.ts`. Each non-root manifest page has an explicit exact-path rewrite to its HTML entry. `/` uses `index.html` normally. There is no SPA catch-all, so unknown paths and missing assets must return HTTP 404 rather than serving the home page with HTTP 200.

`packages/client/public/404.html` is copied to `dist/404.html` for Vercel's static custom error page. It works without JavaScript, provides a home link, and respects the system light/dark preference. Do not add a blanket rewrite to `/404.html`: that would turn missing resources into successful HTML responses. Vite development/preview may use their own 404 response rather than this custom body; the important contract is the actual 404 status.

For another static host, configure only the manifest's pretty-path mappings and serve `404.html` as the error document with status 404, not as a successful fallback.

## Authentication and data

The root document sends signed-in users to `/calendar` and signed-out users to `/login`. Protected documents wait for session restoration and send signed-out users to `/login?next=...`. Login and sign-up are separate documents, preserve the requested destination, and redirect after authentication. Return destinations are restricted to known finance paths; external URLs are not accepted. No token is placed in a URL.

Page protection metadata is not server-side authorization: static HTML documents are public. Page code handles the protected-page sign-in flow, while APIs remain responsible for access control using authenticated Bearer requests. Existing authentication behavior and API endpoints are unchanged by this deployment configuration. Never embed access tokens or other secrets in HTML or URLs.

No database migration is needed.

## Validation checklist

```sh
npm test --workspace=@my-finance/client
npm run build
```

`navigation.test.ts` covers validated dates, links, and safe login return destinations. `pages.test.ts` checks entry documents, Vercel mappings, and mocked Vite development/preview routing. These tests were added but not executed by the agent; no terminal tool is available.

After building, verify direct loads and refreshes for every manifest route, a trailing-slash route in dev/preview, and a date query such as `/day?date=2026-10-11`. Confirm that:

- All eight HTML entries and `404.html` exist in `dist`.
- Each page selects its own `data-page` and manifest title.
- Existing assets still load and API requests still reach the API.
- An unknown path and a missing asset both return HTTP 404, not the home page.
- Protected APIs reject unauthorized requests independently of page navigation.
- Production unknown URLs show the static custom 404 with HTTP 404.

Builds, tests, preview requests, and deployed HTTP status checks require a terminal or deployment environment; they cannot be verified through editor diagnostics alone.
