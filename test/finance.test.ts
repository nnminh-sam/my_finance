import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import type { FinanceSettings, SpendingInput } from '../src/services/finance';
import type { RepeatRule, RepeatRuleInput, Spending } from '../src/types';

let createFinanceApi: typeof import('../src/services/finance').createFinanceApi;

before(async () => {
  // The injected fetcher needs no browser auth, and Node's auth channel would keep the process alive.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });
  try {
    ({ createFinanceApi } = await import('../src/services/finance'));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'BroadcastChannel', descriptor);
    else Reflect.deleteProperty(globalThis, 'BroadcastChannel');
  }
});

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const settings: FinanceSettings = {
  avatar: 'https://example.test/avatar.png',
  categories: [{ id: 'food', name: 'Food', color: '#123456', icon: 'Utensils' }],
};
const input: SpendingInput = {
  amount: 125,
  description: 'Lunch',
  category: 'food',
  date: '2020-01-02',
  time: '12:30',
};

const repeatInput: RepeatRuleInput = {
  amount: 25,
  description: 'Breakfast',
  category: 'food',
  startDate: '2026-10-11',
  time: '08:00',
  frequency: 'daily',
  interval: 1,
  endType: 'unlimited',
};

const sampleRule: RepeatRule = {
  id: '00000000-0000-4000-8000-000000000099',
  userId: 'user-1',
  amount: 25,
  description: 'Breakfast',
  category: 'food',
  startDate: '2026-10-11',
  time: '08:00',
  frequency: 'daily',
  interval: 1,
  endType: 'unlimited',
  totalOccurrences: null,
  endDate: null,
  occurrencesCreated: 100,
  lastGeneratedDate: '2027-01-18',
  createdAt: '2026-10-11T00:00:00.000Z',
};

function spending(index: number): Spending {
  return {
    ...input,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    amount: index,
    description: `Server record ${index}`,
  };
}

function scriptedApi(responses: Response[]) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const api = createFinanceApi(async (path, init) => {
    calls.push({ path, init });
    const next = responses[calls.length - 1];
    assert.ok(next, `Unexpected request: ${path}`);
    return next;
  });
  return { api, calls };
}

function assertJsonRequest(call: { path: string; init?: RequestInit }, path: string, method: string, body: unknown) {
  assert.equal(call.path, path);
  assert.equal(call.init?.method, method);
  assert.equal(new Headers(call.init?.headers).get('Content-Type'), 'application/json');
  assert.equal(typeof call.init?.body, 'string');
  assert.deepEqual(JSON.parse(call.init!.body as string), body);
}

test('settings reads and partial updates return server settings', async () => {
  const updates = { avatar: 'https://example.test/new-avatar.png' };
  const saved = { ...settings, avatar: 'https://example.test/server-avatar.png' };
  const { api, calls } = scriptedApi([
    response({ settings }),
    response({ settings: saved }),
  ]);
  assert.deepEqual(await api.getSettings(), settings);
  assert.deepEqual(calls[0], { path: '/api/v1/finance/settings', init: undefined });
  assert.deepEqual(await api.updateSettings(updates), saved);
  assertJsonRequest(calls[1], '/api/v1/finance/settings', 'PUT', updates);
  assert.deepEqual(updates, { avatar: 'https://example.test/new-avatar.png' });
  assert.equal(calls.length, 2);
});

test('getSpendings loads more than 500 records through UUID cursors and deduplicates IDs', async () => {
  const records = Array.from({ length: 1001 }, (_, index) => spending(index + 1));
  const replacement = { ...records[0], amount: 9999, description: 'Updated server record' };
  const { api, calls } = scriptedApi([
    response({ spendings: records.slice(0, 500), nextCursor: records[499].id }),
    response({ spendings: records.slice(500, 1000), nextCursor: records[999].id }),
    response({ spendings: [replacement, records[1000]], nextCursor: null }),
  ]);

  const result = await api.getSpendings();
  assert.deepEqual(result, [replacement, ...records.slice(1)]);
  assert.equal(result.length, 1001);
  assert.equal(new Set(result.map(record => record.id)).size, 1001);
  assert.deepEqual(calls.map(call => call.path), [
    '/api/v1/finance/spendings?limit=500',
    `/api/v1/finance/spendings?limit=500&cursor=${records[499].id}`,
    `/api/v1/finance/spendings?limit=500&cursor=${records[999].id}`,
  ]);
  assert.ok(calls.every(call => call.init === undefined));
});

test('empty server spendings remain empty with no generated records', async () => {
  const { api, calls } = scriptedApi([response({ spendings: [], nextCursor: null })]);
  assert.deepEqual(await api.getSpendings(), []);
  assert.equal(calls.length, 1);
});

test('an empty final page still returns only the earlier server records', async () => {
  const record = spending(1);
  const { api, calls } = scriptedApi([
    response({ spendings: [record], nextCursor: record.id }),
    response({ spendings: [], nextCursor: null }),
  ]);
  assert.deepEqual(await api.getSpendings(), [record]);
  assert.equal(calls.length, 2);
});

test('a failed later page rejects instead of resolving partial spendings', async () => {
  const record = spending(1);
  const { api, calls } = scriptedApi([
    response({ spendings: [record], nextCursor: record.id }),
    response({ error: 'Page unavailable' }, 503),
  ]);
  await assert.rejects(api.getSpendings(), { message: 'Page unavailable' });
  assert.equal(calls.length, 2);
});

test('a network failure on a later page rejects instead of returning partial spendings', async () => {
  const failure = new Error('Connection lost');
  let calls = 0;
  const api = createFinanceApi(async () => {
    calls++;
    if (calls === 1) return response({ spendings: [spending(1)], nextCursor: spending(1).id });
    throw failure;
  });
  await assert.rejects(api.getSpendings(), error => error === failure);
  assert.equal(calls, 2);
});

test('invalid JSON on a later page cannot resolve a partial success', async () => {
  const { api, calls } = scriptedApi([
    response({ spendings: [spending(1)], nextCursor: spending(1).id }),
    new Response('not json', { status: 200 }),
  ]);
  await assert.rejects(api.getSpendings(), SyntaxError);
  assert.equal(calls.length, 2);
});

for (const [name, cursors] of [
  ['immediately repeated', [spending(1).id, spending(1).id]],
  ['cyclic', [spending(1).id, spending(2).id, spending(1).id]],
] as const) {
  test(`getSpendings rejects ${name} cursors without requesting another page`, async () => {
    const { api, calls } = scriptedApi(cursors.map(nextCursor => response({ spendings: [], nextCursor })));
    await assert.rejects(api.getSpendings(), {
      message: 'The server returned a repeated finance page. Please reload.',
    });
    assert.equal(calls.length, cursors.length);
  });
}

test('create and update send exact write bodies and return authoritative server records', async () => {
  const original = { ...input };
  const created = { ...spending(7), amount: 124, description: 'Server-normalized lunch' };
  const updated = { ...spending(8), amount: 126, description: 'Server-normalized update' };
  const id = 'server/id with spaces?';
  const { api, calls } = scriptedApi([
    response({ spending: created }, 201),
    response({ spending: updated }),
  ]);

  assert.deepEqual(await api.createSpending(input), created);
  assertJsonRequest(calls[0], '/api/v1/finance/spendings', 'POST', input);
  assert.equal(Object.hasOwn(JSON.parse(calls[0].init!.body as string), 'id'), false);
  assert.deepEqual(await api.updateSpending(id, input), updated);
  assertJsonRequest(calls[1], `/api/v1/finance/spendings/${encodeURIComponent(id)}`, 'PUT', input);
  assert.equal(Object.hasOwn(JSON.parse(calls[1].init!.body as string), 'id'), false);
  assert.deepEqual(input, original);
  assert.equal(calls.length, 2);
});

test('create does not resolve an optimistic record while the server response is pending', async () => {
  let resolve!: (value: Response) => void;
  const serverResponse = new Promise<Response>(done => { resolve = done; });
  const api = createFinanceApi(async () => serverResponse);
  let settled = false;
  const pending = api.createSpending(input).then(record => {
    settled = true;
    return record;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  const saved = spending(42);
  resolve(response({ spending: saved }, 201));
  assert.deepEqual(await pending, saved);
});

test('delete uses the encoded server ID and accepts 204 without parsing JSON', async () => {
  const deleted = response(null, 204);
  deleted.json = async () => { assert.fail('A 204 response must not be parsed as JSON'); };
  const { api, calls } = scriptedApi([deleted]);
  const id = 'server/id with spaces?';
  assert.equal(await api.deleteSpending(id), undefined);
  assert.deepEqual(calls, [{
    path: `/api/v1/finance/spendings/${encodeURIComponent(id)}`,
    init: { method: 'DELETE' },
  }]);
});

test('getRepeatRules requests GET /repeat-rules and returns rules array', async () => {
  const { api, calls } = scriptedApi([response({ repeatRules: [sampleRule] })]);
  assert.deepEqual(await api.getRepeatRules(), [sampleRule]);
  assert.deepEqual(calls, [{ path: '/api/v1/finance/repeat-rules', init: undefined }]);
});

test('createRepeatRule posts payload and returns rule with generated spendings', async () => {
  const { api, calls } = scriptedApi([response({ repeatRule: sampleRule, spendings: [spending(1)] }, 201)]);
  const res = await api.createRepeatRule(repeatInput);
  assert.deepEqual(res, { repeatRule: sampleRule, spendings: [spending(1)] });
  assert.deepEqual(calls, [{
    path: '/api/v1/finance/repeat-rules',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(repeatInput),
    },
  }]);
});

test('deleteRepeatRule sends encoded ID and query flag and accepts 204', async () => {
  const deleted = response(null, 204);
  deleted.json = async () => { assert.fail('A 204 response must not be parsed as JSON'); };
  const { api, calls } = scriptedApi([deleted]);
  const id = 'rule/id with spaces?';
  assert.equal(await api.deleteRepeatRule(id), undefined);
  assert.deepEqual(calls, [{
    path: `/api/v1/finance/repeat-rules/${encodeURIComponent(id)}?deleteFuture=true`,
    init: { method: 'DELETE' },
  }]);
});

test('syncRepeatRules posts asOfDate payload and returns created count', async () => {
  const { api, calls } = scriptedApi([response({ spendingsCreated: 15 })]);
  const res = await api.syncRepeatRules('2026-10-11');
  assert.deepEqual(res, { spendingsCreated: 15 });
  assert.deepEqual(calls, [{
    path: '/api/v1/finance/repeat-rules/sync',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asOfDate: '2026-10-11' }),
    },
  }]);
});

type FinanceApi = ReturnType<typeof createFinanceApi>;
const operations: [string, (api: FinanceApi) => Promise<unknown>][] = [
  ['getSettings', api => api.getSettings()],
  ['updateSettings', api => api.updateSettings({ avatar: '' })],
  ['getSpendings', api => api.getSpendings()],
  ['createSpending', api => api.createSpending(input)],
  ['updateSpending', api => api.updateSpending(spending(1).id, input)],
  ['deleteSpending', api => api.deleteSpending(spending(1).id)],
  ['getRepeatRules', api => api.getRepeatRules()],
  ['createRepeatRule', api => api.createRepeatRule(repeatInput)],
  ['deleteRepeatRule', api => api.deleteRepeatRule('rule-1')],
  ['syncRepeatRules', api => api.syncRepeatRules()],
];

for (const [name, operation] of operations) {
  test(`${name} rejects HTTP failures rather than reporting success`, async () => {
    const { api, calls } = scriptedApi([response({ error: 'Finance access denied' }, 403)]);
    await assert.rejects(operation(api), { message: 'Finance access denied' });
    assert.equal(calls.length, 1);
  });
}

for (const [name, failedResponse] of [
  ['non-JSON response', () => new Response('Service unavailable', { status: 503 })],
  ['missing error', () => response({}, 500)],
  ['non-string error', () => response({ error: { message: 'Internal failure' } }, 500)],
  ['null body', () => response(null, 500)],
] as const) {
  test(`HTTP errors use a safe fallback for a ${name}`, async () => {
    const { api } = scriptedApi([failedResponse()]);
    await assert.rejects(api.createSpending(input), {
      message: 'Unable to load or save finance data. Please try again.',
    });
  });
}
