export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  expiresIn: number;
}

interface Session extends AuthResponse {
  expiresAt: number;
  generation: string;
}

interface Coordination {
  revision: number;
  generation: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const COORDINATION_KEY = 'mf-auth-coordination';
let revision = -1;
let session: Session | null = null;
let state: AuthState = { user: null, loading: true, error: null };
let restorePromise: Promise<void> | undefined;
let refreshPromise: Promise<Session> | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('mf-auth') : null;

function coordination(): Coordination {
  const raw = localStorage.getItem(COORDINATION_KEY);
  if (!raw) return { revision: 0, generation: null };
  const value = JSON.parse(raw) as Coordination;
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || (value.generation !== null && typeof value.generation !== 'string')) {
    throw new Error('Browser session coordination is unavailable. Clear this site’s storage and sign in again.');
  }
  return value;
}

function applySession(next: Session | null, nextRevision: number, error: string | null = null) {
  revision = nextRevision;
  session = next;
  state = { user: next?.user ?? null, loading: false, error };
  clearTimeout(refreshTimer);
  if (next) {
    refreshTimer = setTimeout(() => {
      void refreshSession(undefined, next.generation).catch(() => {});
    }, Math.max(1000, next.expiresAt - Date.now() - 60_000));
  }
  listeners.forEach(listener => listener());
}

// Only coordination metadata is persisted; credentials always remain in memory.
// Called while holding the shared lock, including for logout and refresh failures.
function publishSession(next: Session | null, error: string | null = null) {
  const meta = { revision: coordination().revision + 1, generation: next?.generation ?? null };
  localStorage.setItem(COORDINATION_KEY, JSON.stringify(meta));
  applySession(next, meta.revision, error);
  channel?.postMessage({ type: 'session', revision: meta.revision, session: next });
}

channel?.addEventListener('message', event => {
  if (event.data?.type !== 'session') return;
  try {
    const meta = coordination();
    if (event.data.revision > revision && event.data.revision === meta.revision) {
      applySession(event.data.session as Session | null, meta.revision);
    }
  } catch {
    // A broadcast must not replace newer state if coordination storage is unavailable.
  }
});

// Hold the lock through response processing: the rotated cookie must be applied first.
async function withAuthLock<T>(operation: () => Promise<T>): Promise<T> {
  if (!navigator.locks || !channel) {
    throw new Error('Secure sessions require a browser with Web Locks and BroadcastChannel support. Please use a current browser over HTTPS (or localhost).');
  }
  return await navigator.locks.request('mf-auth-mutation', async () => {
    const meta = coordination();
    // Check write access before changing server-side credentials.
    localStorage.setItem(COORDINATION_KEY, JSON.stringify(meta));
    return operation();
  });
}

async function request<T>(path: string, body?: unknown, accessToken?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try signing in again.', 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(data?.error ?? 'The authentication service is unavailable.', response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function toSession(data: AuthResponse, generation: string): Session {
  return { ...data, generation, expiresAt: Date.now() + data.expiresIn * 1000 };
}

function assertGeneration(expected: string | undefined, current: string | null) {
  if (expected !== undefined && expected !== current) throw new Error('Your account session changed. Please retry the action.');
}

function refreshSession(rejectedToken?: string, expectedGeneration?: string): Promise<Session> {
  if (refreshPromise) {
    return refreshPromise.then(next => { assertGeneration(expectedGeneration, next.generation); return next; });
  }
  refreshPromise = withAuthLock(async () => {
    const meta = coordination();
    assertGeneration(expectedGeneration, meta.generation);
    if (!session && meta.revision > 0 && meta.generation === null) {
      // Preserve explicit local logout even if its server response was lost.
      applySession(null, meta.revision);
      throw new ApiError('Authentication required', 401);
    }
    if (session && revision === meta.revision && session.expiresAt > Date.now() + 60_000 && session.accessToken !== rejectedToken) {
      return session;
    }
    try {
      const next = toSession(await request<AuthResponse>('refresh', {}), meta.generation ?? crypto.randomUUID());
      publishSession(next);
      return next;
    } catch (error) {
      // Never blindly retry rotation: a lost response may have consumed the old token.
      publishSession(null, error instanceof ApiError && error.status === 401 ? null : errorMessage(error));
      throw error;
    }
  }).finally(() => { refreshPromise = undefined; });
  return refreshPromise;
}

export function restoreSession(): Promise<void> {
  restorePromise ??= refreshSession().then(() => {}, error => {
    if (state.loading) applySession(null, revision, errorMessage(error));
  });
  return restorePromise;
}

export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getAuthState() { return state; }

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export async function signIn(email: string, password: string) {
  await withAuthLock(async () => {
    coordination();
    publishSession(toSession(await request<AuthResponse>('login', { email, password }), crypto.randomUUID()));
  });
}

export async function signUp(name: string, email: string, password: string) {
  await withAuthLock(async () => {
    coordination();
    publishSession(toSession(await request<AuthResponse>('register', { name, email, password }), crypto.randomUUID()));
  });
}

export async function signOut() {
  await withAuthLock(async () => {
    let failure: unknown;
    try {
      await request<void>('logout', {}, session?.accessToken);
    } catch (error) {
      failure = error;
    } finally {
      publishSession(null, failure ? 'Signed out locally, but server revocation could not be confirmed. Sign in again when the service is available.' : null);
    }
    if (failure) throw failure;
  });
}

/** For protected APIs: retries once after expiry, never under a replacement login. */
export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
    throw new Error('Authenticated requests must use a same-origin /api/ path.');
  }
  if (!session) throw new Error('Please sign in to continue.');
  const original = session;
  let active = session.expiresAt <= Date.now() + 60_000 || revision !== coordination().revision
    ? await refreshSession(undefined, original.generation) : session;
  const assertIdentity = () => {
    assertGeneration(original.generation, coordination().generation);
    if (active.user.id !== original.user.id) throw new Error('Your account changed. Please retry the action.');
  };
  const send = (token: string) => {
    assertIdentity();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers, credentials: 'include', redirect: 'error' });
  };
  let response = await send(active.accessToken);
  if (response.status === 401) {
    active = await refreshSession(active.accessToken, original.generation);
    response = await send(active.accessToken);
    if (response.status === 401) {
      await withAuthLock(async () => {
        const meta = coordination();
        if (meta.generation === original.generation && revision === meta.revision && session?.accessToken === active.accessToken) {
          publishSession(null, 'Your session has expired. Please sign in again.');
        }
      });
    }
  }
  return response;
}
