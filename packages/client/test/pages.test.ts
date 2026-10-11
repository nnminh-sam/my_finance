import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { isPage, pages } from '../src/pages';

const clientRoot = new URL('..', import.meta.url);
const expectedPages = {
  home: { path: '/', html: 'index.html', title: 'MyFinance', protected: false },
  login: { path: '/login', html: 'login.html', title: 'Sign in · MyFinance', protected: false },
  signup: { path: '/signup', html: 'signup.html', title: 'Create account · MyFinance', protected: false },
  calendar: { path: '/calendar', html: 'calendar.html', title: 'Calendar · MyFinance', protected: true },
  week: { path: '/week', html: 'week.html', title: 'Week · MyFinance', protected: true },
  day: { path: '/day', html: 'day.html', title: 'Day details · MyFinance', protected: true },
  analytics: { path: '/analytics', html: 'analytics.html', title: 'Analytics · MyFinance', protected: true },
  profile: { path: '/profile', html: 'profile.html', title: 'Profile · MyFinance', protected: true },
};

test('manifest defines distinct public and protected document routes', () => {
  assert.deepEqual(pages, expectedPages);
  assert.equal(new Set(Object.values(pages).map(page => page.path)).size, Object.keys(pages).length);
  assert.equal(new Set(Object.values(pages).map(page => page.html)).size, Object.keys(pages).length);
  for (const name of Object.keys(pages)) assert.equal(isPage(name), true, name);
  for (const value of [undefined, '', 'unknown', 'Calendar', '/calendar', 'calendar.html', '__proto__', 'constructor', 'toString']) {
    assert.equal(isPage(value), false, String(value));
  }
});

test('every manifest entry has its own root HTML document with the correct bootstrap and fallback', async t => {
  const htmlFiles = readdirSync(clientRoot).filter(name => name.endsWith('.html')).sort();
  assert.deepEqual(htmlFiles, Object.values(pages).map(page => page.html).sort());
  for (const [name, page] of Object.entries(pages)) {
    await t.test(page.html, () => {
      const html = readFileSync(new URL(page.html, clientRoot), 'utf8');
      assert.match(html, /<!doctype html>/i);
      const roots = [...html.matchAll(/<div\b(?=[^>]*\bid=["']root["'])[^>]*>/g)];
      assert.equal(roots.length, 1, 'exactly one React root');
      assert.match(roots[0][0], new RegExp(`\\bdata-page=["']${name}["']`));
      const titles = [...html.matchAll(/<title>([\s\S]*?)<\/title>/g)];
      assert.equal(titles.length, 1, 'exactly one title');
      assert.equal(titles[0][1], page.title);
      const moduleScripts = [...html.matchAll(/<script\b(?=[^>]*\btype=["']module["'])[^>]*>/g)];
      assert.equal(moduleScripts.length, 1, 'exactly one module entry');
      assert.match(moduleScripts[0][0], /\bsrc=["']\/src\/main\.tsx["']/);
      const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
      assert.ok(noscript, 'JavaScript-disabled visitors get an explanation');
      assert.match(noscript[1], /requires JavaScript/i);
            assert.match(noscript[1], /\bMyFinance\b/);
    });
  }
});

test('404 document uses the MyFinance title branding', () => {
  const html = readFileSync(new URL('public/404.html', clientRoot), 'utf8');
  const titles = [...html.matchAll(/<title>([\s\S]*?)<\/title>/g)];
  assert.equal(titles.length, 1, 'exactly one title');
  assert.equal(titles[0][1], 'Page not found · MyFinance');
});

test('Vercel keeps the API rewrite first and only explicit page rewrites, with no SPA catchall', () => {
  const config = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.buildCommand, 'npm run build --workspace=@my-finance/client');
  assert.equal(config.outputDirectory, 'packages/client/dist');
  assert.deepEqual(config.rewrites[0], { source: '/api/(.*)', destination: '/api/index.ts' });
  const expectedRewrites = Object.values(pages)
    .filter(page => page.path !== '/')
    .map(page => ({ source: page.path, destination: `/${page.html}` }));
  assert.equal(config.rewrites.length, expectedRewrites.length + 1);
  assert.deepEqual(
    [...config.rewrites.slice(1)].sort((a, b) => a.source.localeCompare(b.source)),
    expectedRewrites.sort((a, b) => a.source.localeCompare(b.source)),
  );
  assert.equal(config.routes, undefined, 'no separate routing table can add a catchall');
});

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

test('Vite builds all HTML entries as an MPA and routes pretty URLs in dev and preview', async t => {
  // Import the real config; no Vite server or network listener is started.
  const { default: config } = await import('../vite.config');
  assert.equal(config.appType, 'mpa');
  assert.equal(config.root, fileURLToPath(clientRoot));
  assert.equal(config.server?.port, 5173);
  assert.equal(config.server?.strictPort, true);
  assert.equal(config.preview?.port, config.server?.port, 'preview must use the default API-authorized origin');
  assert.equal(config.preview?.strictPort, true);
  assert.deepEqual(
    config.build?.rollupOptions?.input,
    Object.fromEntries(Object.entries(pages).map(([name, page]) => [name, resolve(fileURLToPath(clientRoot), page.html)])),
  );
  const plugin = config.plugins?.flat().find((candidate): candidate is Plugin =>
    !!candidate && typeof candidate === 'object' && 'name' in candidate && candidate.name === 'manifest-page-routing',
  );
  assert.ok(plugin, 'manifest routing plugin is installed');

  for (const hookName of ['configureServer', 'configurePreviewServer'] as const) {
    await t.test(hookName, () => {
      const registered: Middleware[] = [];
      const server = {
        middlewares: { use: (middleware: Middleware) => { registered.push(middleware); } },
      } as unknown as ViteDevServer & PreviewServer;
      const hook = plugin[hookName];
      assert.ok(typeof hook === 'function', `${hookName} must install routing before Vite's HTML middleware`);
      assert.equal(hook.call(undefined, server), undefined, 'routing is not deferred to a post hook');
      assert.equal(registered.length, 1);
      const middleware = registered[0];
      const response = {} as ServerResponse;

      function rewritten(url: string | undefined) {
        const request = { url } as IncomingMessage;
        let nextCalls = 0;
        middleware(request, response, () => { nextCalls += 1; });
        assert.equal(nextCalls, 1, `next called once for ${String(url)}`);
        return request.url;
      }

      const query = '?date=2024-02-29&filter=food%20%26%20drink&tag=a&tag=b';
      for (const page of Object.values(pages)) {
        for (const route of page.path === '/' ? ['/'] : [page.path, `${page.path}/`]) {
          assert.equal(rewritten(route), `/${page.html}`, route);
          assert.equal(rewritten(route + query), `/${page.html}${query}`, route);
          assert.equal(rewritten(`${route}?`), `/${page.html}?`, route);
        }
        assert.equal(rewritten(`/${page.html}${query}`), `/${page.html}${query}`);
      }

      // Unmatched requests must reach Vite/proxy handling, never a home-document fallback.
      for (const url of [
        undefined, '', '/api', '/api/spendings?date=2024-02-29', '/api/calendar',
        '/assets/app.js', '/assets/app.css?version=1', '/favicon.svg', '/src/main.tsx', '/@vite/client',
        '/404.html', '/unknown', '/unknown?date=2024-02-29', '/calendar/missing', '/Calendar',
        '/%63alendar', '//calendar', '/calendar//',
      ]) {
        assert.equal(rewritten(url), url, String(url));
      }
    });
  }
});
