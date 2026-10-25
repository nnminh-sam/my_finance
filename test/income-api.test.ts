import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinanceApi } from '../src/services/finance';
import type { Income, IncomeInput } from '../src/types';

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const input: IncomeInput = {
  source: 'Freelance',
  name: 'Client A',
  amount: 125.5,
  frequency: 'weekly',
  startDate: '2020-01-06',
  endDate: null,
};

function entry(index: number): Income {
  return {
    ...input,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    frequency: index % 2 === 0 ? 'monthly' : 'once',
    amount: index,
    name: `Server income ${index}`,
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

test('getIncomes loads more than 500 incomes, deduplicating IDs with the latest server value', async () => {
  const records = Array.from({ length: 1001 }, (_, index) => entry(index + 1));
  const replacement = { ...records[0], startDate: '2022-03-01', amount: 9999, name: 'Updated server income' };
  const { api, calls } = scriptedApi([
    response({ incomes: records.slice(0, 500), nextCursor: records[499].id }),
    response({ incomes: records.slice(500, 1000), nextCursor: records[999].id }),
    response({ incomes: [replacement, records[1000]], nextCursor: null }),
  ]);

  const result = await api.getIncomes();
  assert.deepEqual(result, [replacement, ...records.slice(1)]);
  assert.equal(result.length, 1001);
  assert.equal(new Set(result.map(record => record.id)).size, 1001);
  assert.deepEqual(calls.map(call => call.path), [
    '/api/v1/finance/incomes?limit=500',
    `/api/v1/finance/incomes?limit=500&cursor=${records[499].id}`,
    `/api/v1/finance/incomes?limit=500&cursor=${records[999].id}`,
  ]);
  assert.ok(calls.every(call => call.init === undefined));
});

test('empty server incomes remain empty without generated records', async () => {
  const { api, calls } = scriptedApi([response({ incomes: [], nextCursor: null })]);
  assert.deepEqual(await api.getIncomes(), []);
  assert.deepEqual(calls, [{ path: '/api/v1/finance/incomes?limit=500', init: undefined }]);
});

test('an empty final page preserves only the earlier server incomes', async () => {
  const record = entry(1);
  const { api, calls } = scriptedApi([
    response({ incomes: [record], nextCursor: record.id }),
    response({ incomes: [], nextCursor: null }),
  ]);
  assert.deepEqual(await api.getIncomes(), [record]);
  assert.equal(calls.length, 2);
});

test('pagination follows nextCursor even for an empty page and escapes the cursor query', async () => {
  const cursor = 'server/id with spaces?&=+#';
  const record = entry(1);
  const { api, calls } = scriptedApi([
    response({ incomes: [], nextCursor: cursor }),
    response({ incomes: [record], nextCursor: null }),
  ]);
  assert.deepEqual(await api.getIncomes(), [record]);
  assert.equal(calls.length, 2);
  const url = new URL(calls[1].path, 'https://example.test');
  assert.equal(url.pathname, '/api/v1/finance/incomes');
  assert.deepEqual([...url.searchParams], [['limit', '500'], ['cursor', cursor]]);
  assert.equal(url.hash, '');
});

test('a failed later page rejects instead of resolving partial incomes', async () => {
  const record = entry(1);
  const { api, calls } = scriptedApi([
    response({ incomes: [record], nextCursor: record.id }),
    response({ error: 'Income page unavailable' }, 503),
  ]);
  await assert.rejects(api.getIncomes(), { message: 'Income page unavailable' });
  assert.equal(calls.length, 2);
});

test('a network failure on a later page rejects without returning partial incomes', async () => {
  const failure = new Error('Connection lost');
  let calls = 0;
  const api = createFinanceApi(async () => {
    calls++;
    if (calls === 1) return response({ incomes: [entry(1)], nextCursor: entry(1).id });
    throw failure;
  });
  await assert.rejects(api.getIncomes(), error => error === failure);
  assert.equal(calls, 2);
});

test('invalid JSON on a later page cannot resolve a partial income success', async () => {
  const { api, calls } = scriptedApi([
    response({ incomes: [entry(1)], nextCursor: entry(1).id }),
    new Response('not json', { status: 200 }),
  ]);
  await assert.rejects(api.getIncomes(), SyntaxError);
  assert.equal(calls.length, 2);
});

for (const [name, cursors] of [
  ['immediately repeated', [entry(1).id, entry(1).id]],
  ['cyclic', [entry(1).id, entry(2).id, entry(1).id]],
] as const) {
  test(`getIncomes rejects ${name} cursors without requesting another page`, async () => {
    const { api, calls } = scriptedApi(cursors.map(nextCursor => response({ incomes: [], nextCursor })));
    await assert.rejects(api.getIncomes(), {
      message: 'The server returned a repeated income page. Please reload.',
    });
    assert.equal(calls.length, cursors.length);
  });
}

test('create and update send exact income payloads and return authoritative server incomes', async () => {
  const original = { ...input };
  const created = { ...entry(7), ...input, amount: 124.75, name: 'Server-normalized income' };
  const update: IncomeInput = { source: 'Salary', name: '', amount: 250.25, frequency: 'monthly', startDate: '2021-03-05', endDate: '2021-12-31' };
  const originalUpdate = { ...update };
  const id = 'selected/server id?&=#%';
  const updated = { id, ...update, amount: 249.99 };
  const { api, calls } = scriptedApi([
    response({ income: created }, 201),
    response({ income: updated }),
  ]);

  assert.deepEqual(await api.createIncome(input), created);
  assertJsonRequest(calls[0], '/api/v1/finance/incomes', 'POST', original);
  assert.deepEqual(await api.updateIncome(id, update), updated);
  assertJsonRequest(calls[1], `/api/v1/finance/incomes/${encodeURIComponent(id)}`, 'PUT', originalUpdate);
  assert.deepEqual(input, original);
  assert.deepEqual(update, originalUpdate);
  assert.equal(calls.length, 2);
});

for (const method of ['createIncome', 'updateIncome'] as const) {
  test(`${method} waits for the server rather than resolving an optimistic income`, async () => {
    let resolve!: (value: Response) => void;
    const serverResponse = new Promise<Response>(done => { resolve = done; });
    const api = createFinanceApi(async () => serverResponse);
    let settled = false;
    const request = method === 'createIncome'
      ? api.createIncome(input)
      : api.updateIncome(entry(42).id, input);
    const pending = request.then(record => {
      settled = true;
      return record;
    });
    await Promise.resolve();
    assert.equal(settled, false);
    const saved = entry(42);
    resolve(response({ income: saved }, method === 'createIncome' ? 201 : 200));
    assert.deepEqual(await pending, saved);
  });
}

test('delete targets the escaped selected ID and returns undefined for 204 without parsing JSON', async () => {
  const deleted = response(null, 204);
  deleted.json = async () => { assert.fail('A 204 response must not be parsed as JSON'); };
  const { api, calls } = scriptedApi([deleted]);
  const id = 'selected/server id?&=#%';
  assert.equal(await api.deleteIncome(id), undefined);
  assert.deepEqual(calls, [{
    path: `/api/v1/finance/incomes/${encodeURIComponent(id)}`,
    init: { method: 'DELETE' },
  }]);
});

type FinanceApi = ReturnType<typeof createFinanceApi>;
const operations: [string, (api: FinanceApi) => Promise<unknown>][] = [
  ['getIncomes', api => api.getIncomes()],
  ['createIncome', api => api.createIncome(input)],
  ['updateIncome', api => api.updateIncome(entry(1).id, input)],
  ['deleteIncome', api => api.deleteIncome(entry(1).id)],
];

for (const [name, operation] of operations) {
  test(`${name} preserves the API error and rejects non-success responses`, async () => {
    const { api, calls } = scriptedApi([response({ error: 'Income access denied' }, 403)]);
    await assert.rejects(operation(api), { message: 'Income access denied' });
    assert.equal(calls.length, 1);
  });

  for (const [failure, failedResponse] of [
    ['non-JSON response', () => new Response('Service unavailable', { status: 503 })],
    ['missing error', () => response({}, 500)],
    ['non-string error', () => response({ error: { message: 'Internal failure' } }, 500)],
    ['null body', () => response(null, 500)],
  ] as const) {
    test(`${name} rejects a ${failure} with a safe fallback error`, async () => {
      const { api, calls } = scriptedApi([failedResponse()]);
      await assert.rejects(operation(api), {
        message: 'Unable to load or save finance data. Please try again.',
      });
      assert.equal(calls.length, 1);
    });
  }
}
