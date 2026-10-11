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

When adding or renaming a page, update the manifest and create/update its physical HTML entry and `data-page` value. The client service's `cleanUrls: true` maps all built HTML entries to extensionless paths; no per-page Vercel rewrites are needed.

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

Standalone `npm run dev` uses client port 5173 and API port 4000; Vite proxies `/api` to `http://localhost:4000`. The Vite page-routing plugin runs before internal middleware in both development and preview. It maps only manifest paths (also accepting a single trailing slash), preserves query strings, and does not redirect assets or API requests into page documents.

Build and preview the production output:

```sh
npm run build --workspace=@my-finance/client
npm run preview --workspace=@my-finance/client
```

Preview serves the built files with the same pretty-page routing on port **5173**, matching the default API `APP_ORIGIN`. Stop the client dev server before starting preview. Both dev and preview use strict ports rather than silently switching to an origin the API would reject. Vite preview inherits the development `/api` proxy, so API calls still need a separate API server at `http://localhost:4000`. If choosing a different client port, update the API's `APP_ORIGIN` to match and restart it. Preview is not a replacement for the production API deployment.

To test Vercel service routing locally, run `vercel dev` from the repository root. Set `APP_ORIGIN` to the actual browser origin, for example `http://localhost:3000`, rather than assuming port 5173. With `VERCEL=1`, Vite disables its localhost API proxy because the platform routes `/api` to the server service; the standalone proxy remains enabled otherwise. `VERCEL_ENV=development` is treated as nonproduction unless `NODE_ENV=production` is explicitly set, so local HTTP origins and non-Secure cookies work.

## Production and 404s

Vite sets `appType: 'mpa'` and builds all eight physical HTML entries into `packages/client/dist`, with shared hashed assets. Vercel builds and publishes that directory as a static client service, with an Express server service for public `/api/*` requests.

The root `vercel.json` service configuration is:

```json
{
  "services": {
    "client": {
      "root": "packages/client",
      "framework": "vite",
      "buildCommand": "npm run build",
      "outputDirectory": "dist",
      "cleanUrls": true
    },
    "server": {
      "root": "packages/server",
      "framework": "express",
      "runtime": "node",
      "entrypoint": "src/app.ts",
      "buildCommand": "npm run build"
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": { "service": "server" } },
    { "source": "/(.*)", "destination": { "service": "client" } }
  ]
}
```

The API rewrite must remain first. All non-API paths go to the public static client service; its `cleanUrls` resolves HTML paths, including `/` to `index.html`. The service catch-all selects a service, not a home-page or SPA fallback: unknown paths and missing assets must return HTTP 404 rather than home-page HTML with HTTP 200. The legacy root `api/index.ts` remains as an unused compatibility wrapper; the server service enters through `packages/server/src/app.ts`.

Set the Vercel project's Root Directory to the repository root, not either package. Clear legacy top-level `buildCommand`/`outputDirectory` configuration and dashboard build/output overrides so the per-service settings apply. `packages/shared` is an empty directory that neither app imports; it is not a shared library dependency or a service. No shared-source inclusion setting is currently needed.

Configure shared deployment variables `DATABASE_URL` and `APP_ORIGIN` (the exact frontend HTTPS origin), including the exact origin for each preview deployment. Leave `PORT` unset and normally let Vercel set `NODE_ENV`. Neither service makes internal runtime service calls, so no runtime bindings are needed. Browser requests use same-origin `/api/*`; never expose database credentials or runtime binding values through `VITE_*` variables.

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

`navigation.test.ts` covers validated dates, links, and safe login return destinations. `pages.test.ts` checks entry documents, Vercel mappings, and mocked Vite development/preview routing. No CLI commands, builds, or tests were executed for this documentation update; no terminal tool is available.

After building, verify direct loads and refreshes for every manifest route, a trailing-slash route in dev/preview, and a date query such as `/day?date=2026-10-11`. Confirm that:

- All eight HTML entries and `404.html` exist in `dist`.
- Each page selects its own `data-page` and manifest title.
- Existing assets still load and API requests still reach the API, both with standalone Vite's proxy and with root `vercel dev` service routing.
- `APP_ORIGIN` matches the actual browser origin in local service tests and each deployment.
- An unknown path and a missing asset both return HTTP 404, not the home page.
- Protected APIs reject unauthorized requests independently of page navigation.
- Production unknown URLs show the static custom 404 with HTTP 404.

Builds, tests, preview requests, and deployed HTTP status checks require a terminal or deployment environment; they cannot be verified through editor diagnostics alone.
