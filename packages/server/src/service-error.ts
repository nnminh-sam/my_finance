const diagnostics = {
  '42P01': 'A database table is missing. Run npm run db:migrate --workspace=@my-finance/server against the same database used by this server.',
  '42703': 'The database schema does not match the application. Check the checked-in migrations and selected Neon branch.',
  '28P01': 'PostgreSQL rejected the database credentials. Check DATABASE_URL privately and restart the server.',
  '28000': 'PostgreSQL rejected database authentication. Check the connection credentials and database role.',
  '3D000': 'The selected database does not exist. Check the database selected in DATABASE_URL.',
  '42501': 'The database role lacks permission. Check privileges on the application tables and schema.',
  '53300': 'The database has reached its connection limit. Check Neon capacity and active connections.',
  '57P03': 'The database is temporarily unavailable. Check the Neon endpoint status.',
  '23505': 'A database uniqueness constraint failed. Check the operation and database schema.',
  ENOTFOUND: 'Database hostname resolution failed. Check the Neon hostname and DNS/network connection.',
  EAI_AGAIN: 'DNS resolution temporarily failed. Check the network connection.',
  ECONNREFUSED: 'The database connection was refused. Check the endpoint and network connection.',
  ECONNRESET: 'The database connection was reset. Check the endpoint and network connection.',
  ETIMEDOUT: 'The database request timed out. Check the Neon endpoint and network connection.',
  UND_ERR_CONNECT_TIMEOUT: 'The database HTTP connection timed out. Check network access to Neon.',
  ERR_TLS_CERT_ALTNAME_INVALID: 'Database TLS hostname validation failed. Check the endpoint and proxy configuration.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Database TLS certificate verification failed. Check trusted certificates and network proxies; do not disable TLS verification.',
  ERR_CRYPTO_INVALID_SCRYPT_PARAMS: 'Password hashing parameters were rejected by Node.js. Check the scrypt configuration.',
} as const;

/** Return only allowlisted diagnostics: raw driver messages can contain credentials or SQL. */
export function serviceErrorDiagnostic(error: unknown): { code: string; hint: string } {
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  let fetchFailed = false;
  for (let inspected = 0; pending.length && inspected < 8; inspected++) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    const record = current as Record<string, unknown>;
    if (typeof record.code === 'string' && Object.hasOwn(diagnostics, record.code)) {
      const code = record.code as keyof typeof diagnostics;
      return { code, hint: diagnostics[code] };
    }
    if (record.message === 'fetch failed') fetchFailed = true;
    pending.push(record.cause, record.sourceError);
  }
  if (fetchFailed) return { code: 'FETCH_FAILED', hint: 'The database HTTP request failed. Check connectivity to Neon, DNS, TLS, and any network proxy.' };
  return { code: 'UNKNOWN', hint: 'Unexpected service failure. Check database connectivity, migrations, and the server configuration. Raw error details were omitted to protect credentials.' };
}
