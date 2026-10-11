import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';

const coordinationKey = 'mf-auth-coordination';
const origin = 'https://finance.test';
const alice = { id: 'alice', name: 'Alice', email: 'alice@example.test', createdAt: '2026-01-01' };
const bob = { id: 'bob', name: 'Bob', email: 'bob@example.test', createdAt: '2026-01-02' };

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function authResponse(user = alice, accessToken = 'alice-token') {
  return { user, accessToken, expiresIn: 3600 };
}

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Keep the lock held while JSON is pending, not just until fetch returns headers.
function deferredResponse(body: ReturnType<typeof deferred<unknown>>) {
  const result = response(null);
  result.json = () => body.promise;
  return result;
}

test('browser auth regressions', { concurrency: false }, async t => {
  const storage = new Map<string, string>();
  const savedGlobals = new Map<string, PropertyDescriptor | undefined>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const calls: Array<{ path: string; init: RequestInit }> = [];
  let fetchHandler: (path: string, init: RequestInit) => Response | Promise<Response> = path => {
    throw new Error(`Unexpected fetch: ${path}`);
  };
  let lockTail: Promise<unknown> = Promise.resolve();
  let activeLocks = 0;
  let maxActiveLocks = 0;
  let uuid = 0;

  class MockBroadcastChannel {
    static instance: MockBroadcastChannel;
    readonly sent: unknown[] = [];
    private readonly listeners: Array<(event: { data: unknown }) => void> = [];

    constructor(readonly name: string) {
      MockBroadcastChannel.instance = this;
    }

    addEventListener(type: string, listener: (event: { data: unknown }) => void) {
      assert.equal(type, 'message');
      this.listeners.push(listener);
    }

    postMessage(data: unknown) { this.sent.push(data); }
    emit(data: unknown) { this.listeners.forEach(listener => listener({ data })); }
  }

  function install(name: string, value: unknown) {
    savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  install('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
  });
  install('navigator', {
    locks: {
      request(name: string, operation: () => Promise<unknown>) {
        assert.equal(name, 'mf-auth-mutation');
        const result = lockTail.then(async () => {
          activeLocks++;
          maxActiveLocks = Math.max(maxActiveLocks, activeLocks);
          try { return await operation(); }
          finally { activeLocks--; }
        });
        lockTail = result.catch(() => {});
        return result;
      },
    },
  });
  install('BroadcastChannel', MockBroadcastChannel);
  install('crypto', { randomUUID: () => `generation-${++uuid}` });
  install('window', { location: { origin } });
  install('fetch', (input: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(input instanceof Request ? input.url : input, origin).pathname;
    calls.push({ path, init });
    return Promise.resolve(fetchHandler(path, init));
  });
  install('setTimeout', (callback: () => void, delay: number) => {
    const timer = nativeSetTimeout(callback, delay);
    timer.unref();
    timers.add(timer);
    return timer;
  });
  install('clearTimeout', (timer: ReturnType<typeof setTimeout> | undefined) => {
    nativeClearTimeout(timer);
    if (timer !== undefined) timers.delete(timer);
  });

  // One import and explicitly awaited subtests preserve the module's singleton state.
  let auth: typeof import('../src/auth.ts') | undefined;
  t.after(async () => {
    try {
      if (auth) {
        fetchHandler = path => {
          assert.equal(path, '/api/v1/auth/logout');
          return response(null, 204);
        };
        await auth.signOut();
      }
    } finally {
      for (const timer of timers) nativeClearTimeout(timer);
      for (const [name, descriptor] of savedGlobals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
  const client = auth = await import('../src/auth.ts');
  const channel = MockBroadcastChannel.instance;
  assert.equal(channel.name, 'mf-auth');

  function metadata(): { revision: number; generation: string | null } {
    const raw = storage.get(coordinationKey);
    assert.ok(raw);
    return JSON.parse(raw);
  }

  async function login(user = alice, token = 'alice-token') {
    fetchHandler = (path, init) => {
      assert.equal(path, '/api/v1/auth/login');
      assert.equal(init.method, 'POST');
      assert.equal(init.credentials, 'include');
      assert.equal(init.cache, 'no-store');
      assert.deepEqual(JSON.parse(String(init.body)), { email: user.email, password: 'password' });
      return response(authResponse(user, token));
    };
    await client.signIn(user.email, 'password');
  }

  await t.test('StrictMode restore calls share one flight and remain cached', async () => {
    const body = deferred<unknown>();
    const started = deferred<void>();
    const before = calls.length;
    let notifications = 0;
    const unsubscribe = client.subscribeAuth(() => { notifications++; });
    try {
      fetchHandler = (path, init) => {
        assert.equal(path, '/api/v1/auth/refresh');
        assert.equal(init.method, 'POST');
        assert.equal(init.credentials, 'include');
        assert.equal(init.cache, 'no-store');
        assert.equal(init.body, '{}');
        started.resolve();
        return deferredResponse(body);
      };
      const first = client.restoreSession();
      const second = client.restoreSession();
      assert.equal(first, second);
      await started.promise;
      assert.equal(client.getAuthState().loading, true);
      assert.equal(calls.length - before, 1);
      body.resolve(authResponse());
      await Promise.all([first, second]);
      assert.deepEqual(client.getAuthState(), { user: alice, loading: false, error: null });
      assert.equal(notifications, 1);
      await client.restoreSession();
      assert.equal(calls.length - before, 1);
      assert.deepEqual([...storage.keys()], [coordinationKey]);
      assert.deepEqual(Object.keys(metadata()).sort(), ['generation', 'revision']);
      assert.ok(!storage.get(coordinationKey)!.includes('alice-token'));
    } finally {
      body.resolve(authResponse());
      unsubscribe();
    }
  });

  await t.test('concurrent 401s share refresh and retry once with the new access token', async () => {
    await login();
    const generation = metadata().generation;
    const body = deferred<unknown>();
    const started = deferred<void>();
    let refreshes = 0;
    const tokens: string[] = [];
    fetchHandler = (path, init) => {
      if (path === '/api/v1/auth/refresh') {
        refreshes++;
        started.resolve();
        return deferredResponse(body);
      }
      assert.equal(path, '/api/accounts');
      assert.equal(init.credentials, 'include');
      assert.equal(init.redirect, 'error');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('X-Request'), 'kept');
      const token = headers.get('Authorization')!;
      tokens.push(token);
      return token === 'Bearer alice-token' ? response({}, 401) : response({ ok: true });
    };
    const init = { headers: { 'X-Request': 'kept', Authorization: 'Bearer caller-token' } };
    const first = client.authenticatedFetch('/api/accounts', init);
    const second = client.authenticatedFetch(`${origin}/api/accounts`, init);
    await started.promise;
    await nextTurn();
    assert.equal(refreshes, 1);
    assert.equal(activeLocks, 1);
    body.resolve(authResponse(alice, 'alice-refreshed'));
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.map(result => result.status), [200, 200]);
    assert.deepEqual(tokens, ['Bearer alice-token', 'Bearer alice-token', 'Bearer alice-refreshed', 'Bearer alice-refreshed']);
    assert.equal(metadata().generation, generation);
    assert.equal(init.headers.Authorization, 'Bearer caller-token');
    const before = calls.length;
    await assert.rejects(client.authenticatedFetch('https://other.test/api/accounts'), /same-origin/);
    await assert.rejects(client.authenticatedFetch('/not-api'), /same-origin/);
    assert.equal(calls.length, before);
  });

  await t.test('refresh holds the shared lock through response processing before a queued login', async () => {
    await login();
    const previous = metadata();
    const refreshBody = deferred<unknown>();
    const refreshStarted = deferred<void>();
    const loginBody = deferred<unknown>();
    const loginStarted = deferred<void>();
    let logins = 0;
    fetchHandler = (path, init) => {
      if (path === '/api/v1/auth/refresh') {
        refreshStarted.resolve();
        return deferredResponse(refreshBody);
      }
      if (path === '/api/v1/auth/login') {
        logins++;
        assert.equal(metadata().revision, previous.revision + 1);
        assert.equal(metadata().generation, previous.generation);
        loginStarted.resolve();
        return deferredResponse(loginBody);
      }
      assert.equal(path, '/api/accounts');
      return new Headers(init.headers).get('Authorization') === 'Bearer alice-token'
        ? response({}, 401) : response({ ok: true });
    };
    const request = client.authenticatedFetch('/api/accounts');
    await refreshStarted.promise;
    const signingIn = client.signIn(bob.email, 'password');
    await nextTurn();
    assert.equal(logins, 0);
    assert.equal(activeLocks, 1);
    refreshBody.resolve(authResponse(alice, 'alice-refreshed'));
    await loginStarted.promise;
    assert.equal((await request).status, 200);
    loginBody.resolve(authResponse(bob, 'bob-token'));
    await signingIn;
    assert.equal(maxActiveLocks, 1);
    assert.deepEqual(client.getAuthState().user, bob);
  });

  await t.test('broadcasts require a newer revision matching shared coordination metadata', async () => {
    await login();
    const previous = metadata();
    const next = { revision: previous.revision + 1, generation: 'other-tab-bob' };
    const bobSession = { ...authResponse(bob, 'broadcast-bob'), generation: next.generation, expiresAt: Date.now() + 3_600_000 };
    storage.set(coordinationKey, JSON.stringify(next));
    channel.emit({ type: 'session', revision: next.revision, session: bobSession });
    assert.deepEqual(client.getAuthState().user, bob);
    for (const session of [null, { ...bobSession, user: alice }]) {
      channel.emit({ type: 'session', revision: previous.revision, session });
      channel.emit({ type: 'session', revision: next.revision, session });
      channel.emit({ type: 'session', revision: next.revision + 1, session });
      assert.deepEqual(client.getAuthState().user, bob);
    }
    const latest = { ...next, revision: next.revision + 2 };
    storage.set(coordinationKey, JSON.stringify(latest));
    channel.emit({ type: 'session', revision: next.revision + 1, session: null });
    assert.deepEqual(client.getAuthState().user, bob);
    channel.emit({ type: 'session', revision: latest.revision, session: bobSession });
    fetchHandler = (path, init) => {
      assert.equal(path, '/api/accounts');
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer broadcast-bob');
      return response({ ok: true });
    };
    assert.equal((await client.authenticatedFetch('/api/accounts')).status, 200);
  });

  await t.test('an account change during the first 401 never retries under the new account', async () => {
    await login();
    const unauthorized = deferred<Response>();
    const started = deferred<void>();
    let protectedCalls = 0;
    let refreshes = 0;
    fetchHandler = (path, init) => {
      if (path === '/api/v1/auth/login') return response(authResponse(bob, 'bob-token'));
      if (path === '/api/v1/auth/refresh') {
        refreshes++;
        throw new Error('Must not refresh the replacement account');
      }
      assert.equal(path, '/api/accounts');
      protectedCalls++;
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer alice-token');
      started.resolve();
      return unauthorized.promise;
    };
    const pending = client.authenticatedFetch('/api/accounts');
    const rejected = assert.rejects(pending, /account session changed/);
    await started.promise;
    await client.signIn(bob.email, 'password');
    const replacement = metadata();
    unauthorized.resolve(response({}, 401));
    await rejected;
    assert.equal(protectedCalls, 1);
    assert.equal(refreshes, 0);
    assert.deepEqual(metadata(), replacement);
    assert.deepEqual(client.getAuthState(), { user: bob, loading: false, error: null });
  });

  await t.test('a stale final 401 cannot clear a replacement session', async () => {
    await login();
    const finalResponse = deferred<Response>();
    const retryStarted = deferred<void>();
    const tokens: string[] = [];
    fetchHandler = (path, init) => {
      if (path === '/api/v1/auth/refresh') return response(authResponse(alice, 'alice-refreshed'));
      if (path === '/api/v1/auth/login') return response(authResponse(bob, 'bob-token'));
      assert.equal(path, '/api/accounts');
      const token = new Headers(init.headers).get('Authorization')!;
      tokens.push(token);
      if (token === 'Bearer alice-token') return response({}, 401);
      assert.equal(token, 'Bearer alice-refreshed');
      retryStarted.resolve();
      return finalResponse.promise;
    };
    const pending = client.authenticatedFetch('/api/accounts');
    await retryStarted.promise;
    await client.signIn(bob.email, 'password');
    const replacement = metadata();
    const broadcasts = channel.sent.length;
    finalResponse.resolve(response({}, 401));
    assert.equal((await pending).status, 401);
    assert.deepEqual(tokens, ['Bearer alice-token', 'Bearer alice-refreshed']);
    assert.deepEqual(metadata(), replacement);
    assert.equal(channel.sent.length, broadcasts);
    assert.deepEqual(client.getAuthState(), { user: bob, loading: false, error: null });
  });

  await t.test('failed server logout still clears local auth and publishes a warning', async () => {
    await login();
    const previous = metadata();
    fetchHandler = (path, init) => {
      assert.equal(path, '/api/v1/auth/logout');
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer alice-token');
      return response({ error: 'Revocation unavailable' }, 503);
    };
    await assert.rejects(client.signOut(), /Revocation unavailable/);
    assert.deepEqual(client.getAuthState(), {
      user: null,
      loading: false,
      error: 'Signed out locally, but server revocation could not be confirmed. Sign in again when the service is available.',
    });
    assert.deepEqual(metadata(), { revision: previous.revision + 1, generation: null });
    assert.deepEqual(channel.sent.at(-1), { type: 'session', revision: previous.revision + 1, session: null });
    assert.equal(timers.size, 0);
    const before = calls.length;
    await assert.rejects(client.authenticatedFetch('/api/accounts'), /Please sign in/);
    assert.equal(calls.length, before);
  });

  await t.test('missing cross-tab locking fails closed before sending credentials', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')!;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    try {
      const before = calls.length;
      await assert.rejects(client.signIn(alice.email, 'password'), /Web Locks/);
      assert.equal(calls.length, before);
      assert.equal(client.getAuthState().user, null);
    } finally {
      Object.defineProperty(globalThis, 'navigator', descriptor);
    }
  });
});
