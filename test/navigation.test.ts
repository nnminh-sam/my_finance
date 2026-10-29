import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { authHref, pageHref, readPageDate, safeReturnPath } from '../src/lib/navigation';
import type { FinancePage } from '../src/lib/pages';

const financePaths: Record<FinancePage, string> = {
  calendar: '/calendar',
  week: '/week',
  day: '/day',
  analytics: '/analytics',
  profile: '/profile',
};

test('finance links use separate documents and local dates, except profile', () => {
  const date = new Date(2024, 1, 29, 23, 45, 12, 345);
  const timestamp = date.getTime();
  for (const page of Object.keys(financePaths) as FinancePage[]) {
    assert.equal(pageHref(page), financePaths[page]);
    assert.equal(pageHref(page, date), `${financePaths[page]}${page === 'profile' ? '' : '?date=2024-02-29'}`);
  }
  assert.equal(date.getTime(), timestamp);
});

test('navigation preserves local calendar dates on both sides of UTC', () => {
  const navigationUrl = new URL('../src/lib/navigation.ts', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { pageHref, readPageDate } from ${JSON.stringify(navigationUrl)};
    for (const hour of [0, 23]) {
      const date = new Date(2024, 1, 29, hour, 30);
      for (const page of ['calendar', 'week', 'day', 'analytics']) {
        assert.equal(pageHref(page, date), '/' + page + '?date=2024-02-29');
        const parsed = readPageDate(pageHref(page, date).split('?')[1]);
        assert.deepEqual(
          [parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours()],
          [2024, 1, 29, 0],
        );
      }
      assert.equal(pageHref('profile', date), '/profile');
    }
  `;
  for (const TZ of ['Pacific/Kiritimati', 'America/Los_Angeles']) {
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, TZ },
      timeout: 15_000,
      stdio: 'pipe',
    });
  }
});

test('readPageDate accepts exact valid dates, including leap days and early years', () => {
  const fallback = new Date(2030, 6, 15, 12, 34, 56, 789);
  const timestamp = fallback.getTime();
  for (const [value, year, month, day] of [
    ['2024-02-29', 2024, 1, 29],
    ['2000-02-29', 2000, 1, 29],
    ['2023-12-31', 2023, 11, 31],
    ['0001-01-01', 1, 0, 1],
  ] as const) {
    const result = readPageDate(`?other=keep&date=${value}`, fallback);
    assert.deepEqual(
      [result.getFullYear(), result.getMonth(), result.getDate(), result.getHours(), result.getMinutes()],
      [year, month, day, 0, 0],
      value,
    );
    assert.notStrictEqual(result, fallback);
  }
  assert.equal(readPageDate('?date=2024%2D02%2D29', fallback).getDate(), 29);
  assert.equal(fallback.getTime(), timestamp);
});

test('missing, malformed, impossible and non-leap dates clone the untouched fallback', () => {
  const fallback = new Date(2030, 6, 15, 12, 34, 56, 789);
  const timestamp = fallback.getTime();
  const searches = [
    '', '?other=2024-02-29', '?date=', '?date=undefined', '?date=not-a-date',
    '?date=2023-02-29', '?date=1900-02-29', '?date=2024-02-30', '?date=2024-04-31',
    '?date=2024-00-01', '?date=2024-13-01', '?date=2024-01-00', '?date=2024-01-32',
    '?date=0000-01-01', '?date=-0001-01-01', '?date=10000-01-01',
    '?date=2024-2-29', '?date=24-02-29', '?date=20240229', '?date=2024/02/29',
    '?date=2024-02-29T00:00:00Z', '?date=%202024-02-29', '?date=2024-02-29%20',
  ];
  for (const search of searches) {
    const result = readPageDate(search, fallback);
    assert.equal(result.getTime(), timestamp, search);
    assert.notStrictEqual(result, fallback, search);
    result.setFullYear(1999);
    assert.equal(fallback.getTime(), timestamp, search);
  }
});

test('safe return paths allow only finance pages, preserving queries but dropping hashes', () => {
  for (const path of Object.values(financePaths)) {
    assert.equal(safeReturnPath(path), path);
    const query = '?date=2024-02-29&filter=food%20%26%20drink&tag=a&tag=b&next=https%3A%2F%2Fexample.test';
    assert.equal(safeReturnPath(`${path}${query}#details`), `${path}${query}`);
    assert.equal(safeReturnPath(`${path}#details`), path);
  }
  assert.equal(safeReturnPath('/day?' + 'x'.repeat(2043)), '/day?' + 'x'.repeat(2043));
  assert.equal(safeReturnPath('/day?' + 'x'.repeat(2044)), '/calendar');
});

test('safe return paths reject external, public, unknown and encoded bypass destinations', () => {
  const rejected = [
    null, undefined, '', 'calendar', 'https://example.test/day', 'http://example.test/day',
    'https://tracker.invalid/day', 'javascript:alert(1)', '//example.test/day', '///example.test/day',
    '/\\example.test/day', '\\day', '/day\\foo', '/day?next=\\example.test',
    '/', '/login', '/signup', '/login?next=/day', '/signup#day', '/unknown',
    '/api', '/api/spendings', '/assets/app.js', '/day.html', '/day/', '/DAY',
    '/%64ay', '/%2Fday', '/%2f%2fexample.test/day', '/%5cexample.test/day',
    '/%255cexample.test/day', '/%252f%252fexample.test/day', '/day%00', '/day%0a',
    '/day%0d', '/day%09', '/day%20', '/day%7f', '/day%5c', '/%6cogin', '/%73ignup',
    '/day/../login', '/day/%2e%2e/signup', '/day/%252e%252e/signup',
  ];
  for (const value of rejected) {
    assert.equal(safeReturnPath(value), '/calendar', JSON.stringify(value));
  }
  for (const code of [...Array.from({ length: 33 }, (_, index) => index), 127]) {
    const control = String.fromCharCode(code);
    for (const value of [`${control}/day`, `/day${control}`, `/day?filter=${control}`]) {
      assert.equal(safeReturnPath(value), '/calendar', JSON.stringify(value));
    }
  }
});

test('auth links encode sanitized return paths exactly once for login and signup', () => {
  for (const page of ['login', 'signup'] as const) {
    for (const empty of [undefined, null, '']) assert.equal(authHref(page, empty), `/${page}`);
    const returnTo = '/day?date=2024-02-29&filter=food%20%26%20drink#details';
    const href = authHref(page, returnTo);
    assert.equal(href, `/${page}?next=%2Fday%3Fdate%3D2024-02-29%26filter%3Dfood%2520%2526%2520drink`);
    const url = new URL(href, 'https://tracker.invalid');
    assert.equal(url.pathname, `/${page}`);
    assert.deepEqual([...url.searchParams], [['next', '/day?date=2024-02-29&filter=food%20%26%20drink']]);
    assert.equal(url.hash, '');
    for (const unsafe of ['https://example.test/day', '//example.test/day', '/login', '/%64ay']) {
      assert.equal(authHref(page, unsafe), `/${page}?next=%2Fcalendar`, unsafe);
    }
  }
});

test('mobile navigation splits top header and bottom tab bar at <= 768px', () => {
  const rootDir = new URL('..', import.meta.url);
  const layoutSource = readFileSync(new URL('src/app/(finance)/layout.tsx', rootDir), 'utf8');
  const navCss = readFileSync(new URL('src/styles/navigation.css', rootDir), 'utf8');

  assert.match(layoutSource, /aria-label="Mobile bottom navigation"/);
  assert.match(layoutSource, /className="document-mobile-period"/);
  assert.match(layoutSource, /className="document-action document-profile-btn"/);
  assert.match(layoutSource, /className="document-bottom-add"/);

  assert.match(navCss, /@media \(max-width: 768px\)/);
  assert.match(navCss, /\.document-bottom-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(navCss, /\.document-profile-btn\s*\{[\s\S]*?display:\s*inline-flex/);
});

