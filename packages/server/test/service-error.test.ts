import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceErrorDiagnostic } from '../src/service-error';

test('missing auth schema produces actionable diagnostics without raw database details', () => {
  const result = serviceErrorDiagnostic({ code: '42P01', message: 'secret SQL and credentials', detail: 'password', query: 'secret parameters' });
  assert.equal(result.code, '42P01');
  assert.match(result.hint, /db:migrate/);
  assert.doesNotMatch(JSON.stringify(result), /secret|password|parameters/);
});

test('nested Neon source errors and fetch causes expose only allowlisted codes', () => {
  const result = serviceErrorDiagnostic({ message: 'private database URL', sourceError: { message: 'fetch failed', cause: { code: 'ENOTFOUND', hostname: 'private-host' } } });
  assert.equal(result.code, 'ENOTFOUND');
  assert.doesNotMatch(JSON.stringify(result), /private/);
  assert.equal(serviceErrorDiagnostic(new TypeError('fetch failed')).code, 'FETCH_FAILED');
});

test('credential failures have a safe hint and unknown errors never disclose values', () => {
  const known = serviceErrorDiagnostic({ code: '28P01', message: 'password authentication failed for secret user' });
  assert.equal(known.code, '28P01');
  assert.match(known.hint, /DATABASE_URL/);
  const unknown = serviceErrorDiagnostic({ code: 'secret-token', message: 'postgres://user:password@host/db', stack: 'private stack' });
  assert.equal(unknown.code, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(unknown), /secret-token|postgres:\/\/|private stack/);
});

test('cyclic causes terminate and still classify known source errors', () => {
  const error: { cause?: unknown; sourceError: unknown } = { sourceError: { code: '42501' } };
  error.cause = error;
  assert.equal(serviceErrorDiagnostic(error).code, '42501');
  assert.equal(serviceErrorDiagnostic(null).code, 'UNKNOWN');
});
