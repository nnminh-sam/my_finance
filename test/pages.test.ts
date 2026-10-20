import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { isPage, pages } from '../src/lib/pages';

const rootDir = new URL('..', import.meta.url);
const expectedPages = {
  home: { path: '/', html: 'index.html', title: 'MyFinance', protected: false },
  login: { path: '/login', html: 'login.html', title: 'Sign in · MyFinance', protected: false },
  signup: { path: '/signup', html: 'signup.html', title: 'Create account · MyFinance', protected: false },
  calendar: { path: '/calendar', html: 'calendar.html', title: 'Calendar · MyFinance', protected: true },
  cycle: { path: '/cycle', html: 'cycle.html', title: 'Salary Cycle · MyFinance', protected: true },
  week: { path: '/week', html: 'week.html', title: 'Week · MyFinance', protected: true },
  day: { path: '/day', html: 'day.html', title: 'Day details · MyFinance', protected: true },
  analytics: { path: '/analytics', html: 'analytics.html', title: 'Analytics · MyFinance', protected: true },
  profile: { path: '/profile', html: 'profile.html', title: 'Profile · MyFinance', protected: true },
};

const appRouterFiles: Record<keyof typeof pages, string> = {
  home: 'src/app/page.tsx',
  login: 'src/app/(auth)/login/page.tsx',
  signup: 'src/app/(auth)/signup/page.tsx',
  calendar: 'src/app/(finance)/calendar/page.tsx',
  cycle: 'src/app/(finance)/cycle/page.tsx',
  week: 'src/app/(finance)/week/page.tsx',
  day: 'src/app/(finance)/day/page.tsx',
  analytics: 'src/app/(finance)/analytics/page.tsx',
  profile: 'src/app/(finance)/profile/page.tsx',
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

test('every manifest entry has its own Next.js App Router page and layout with matching metadata', async t => {
  const rootLayout = readFileSync(new URL('src/app/layout.tsx', rootDir), 'utf8');
  assert.match(rootLayout, /pages\.home\.title/);
  const noscript = rootLayout.match(/<noscript>([\s\S]*?)<\/noscript>/);
  assert.ok(noscript, 'JavaScript-disabled visitors get an explanation');
  assert.match(noscript[1], /requires JavaScript/i);
  assert.match(noscript[1], /\bMyFinance\b/);

  for (const [name, page] of Object.entries(pages) as Array<[keyof typeof pages, (typeof pages)[keyof typeof pages]]>) {
    await t.test(name, () => {
      const file = appRouterFiles[name];
      const fullUrl = new URL(file, rootDir);
      assert.equal(existsSync(fullUrl), true, `${file} exists`);
      const source = readFileSync(fullUrl, 'utf8');
      if (name !== 'home') {
        assert.match(source, new RegExp(`pages\\.${name}\\.title`), `${file} references pages.${name}.title`);
      }
      assert.ok(page.title.includes('MyFinance'));
    });
  }
});

test('404 NotFound route and static document use the MyFinance title branding', () => {
  const notFoundTsx = readFileSync(new URL('src/app/not-found.tsx', rootDir), 'utf8');
  assert.match(notFoundTsx, /Page not found · MyFinance/);
  assert.match(notFoundTsx, /This page couldn’t be found\./);

  const html = readFileSync(new URL('public/404.html', rootDir), 'utf8');
  const titles = [...html.matchAll(/<title>([\s\S]*?)<\/title>/g)];
  assert.equal(titles.length, 1, 'exactly one title');
  assert.equal(titles[0][1], 'Page not found · MyFinance');
});

test('Vercel configuration and Next.js API route handlers are aligned', () => {
  const config = JSON.parse(readFileSync(new URL('vercel.json', rootDir), 'utf8'));
  assert.equal(config.$schema, 'https://openapi.vercel.sh/vercel.json');
  assert.equal(config.framework, 'nextjs');
  assert.equal(existsSync(new URL('src/app/api/route.ts', rootDir)), true);
  assert.equal(existsSync(new URL('src/app/api/[...slug]/route.ts', rootDir)), true);
});

test('architecture documentation is built into public/docs for Vercel hosting', () => {
  assert.equal(existsSync(new URL('public/docs/index.html', rootDir)), true);
  assert.equal(existsSync(new URL('public/docs/01-system-architecture.html', rootDir)), true);
  assert.equal(existsSync(new URL('public/docs/assets/style.css', rootDir)), true);
  const pkg = JSON.parse(readFileSync(new URL('package.json', rootDir), 'utf8'));
  assert.match(pkg.scripts.build, /docs\/html\/build\.mjs/);
});
