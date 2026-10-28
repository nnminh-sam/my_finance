import type { Config } from "../config";
import type { ApiKeyScope, AuthStore, User } from "./store";
import {
  ACCESS_SECONDS,
  DUMMY_PASSWORD_HASH,
  REFRESH_SECONDS,
  hashPassword,
  hashToken,
  newApiKey,
  newToken,
  validApiKey,
  validPassword,
  validToken,
  verifyPassword,
} from "./crypto";

export const REFRESH_COOKIE = "mf_refresh";
const COOKIE_PATH = "/api/v1/auth";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function bearerTokenFromHeader(authorization: string | null | undefined): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization ?? "");
  return match?.[1];
}

export function apiKeyFromHeaders(request: Request): string | undefined {
  const auth = request.headers.get("authorization") ?? "";
  const bearerMatch = /^Bearer (mf_pat_[A-Za-z0-9_-]{43})$/i.exec(auth);
  if (bearerMatch && validApiKey(bearerMatch[1])) return bearerMatch[1];
  const headerKey = request.headers.get("x-api-key")?.trim();
  if (headerKey && validApiKey(headerKey)) return headerKey;
  return undefined;
}

function refreshCookiesFromHeader(cookieHeader: string | null | undefined): string[] {
  return (cookieHeader ?? "").split(";").flatMap(part => {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== REFRESH_COOKIE) return [];
    const value = part.slice(separator + 1).trim();
    return validToken(value) ? [value] : [];
  });
}

export async function authenticateRequestWithScope(
  request: Request,
  store: AuthStore,
): Promise<{ user: User; scope: ApiKeyScope }> {
  const apiKey = apiKeyFromHeaders(request);
  if (apiKey) {
    const keyHash = hashToken(apiKey);
    if (store.authenticateApiKey) {
      const auth = await store.authenticateApiKey(keyHash);
      if (!auth) throw new HttpError(401, "Authentication required");
      return auth;
    }
    const account = await store.authenticate(keyHash);
    if (!account) throw new HttpError(401, "Authentication required");
    return { user: account, scope: "write" };
  }
  const token = bearerTokenFromHeader(request.headers.get("authorization"));
  if (!token) throw new HttpError(401, "Authentication required");
  const account = await store.authenticate(hashToken(token));
  if (!account) throw new HttpError(401, "Authentication required");
  return { user: account, scope: "write" };
}

export async function authenticateRequest(request: Request, store: AuthStore): Promise<User> {
  const { user } = await authenticateRequestWithScope(request, store);
  return user;
}

function emailFrom(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const email = (body as Record<string, unknown>).email;
  if (typeof email !== "string") return undefined;
  const normalized = email.trim().toLowerCase();
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function formatRefreshCookie(value: string, production: boolean, clear = false): string {
  const parts = [
    `${REFRESH_COOKIE}=${clear ? "" : value}`,
    `Path=${COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (production) parts.push("Secure");
  if (clear) {
    parts.push("Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  } else {
    parts.push(`Max-Age=${REFRESH_SECONDS}`);
  }
  return parts.join("; ");
}

export async function handleAuthRequest(
  request: Request,
  subpath: string,
  body: unknown,
  store: AuthStore,
  config: Config,
  responseHeaders: Headers,
): Promise<Response> {
  responseHeaders.set("Cache-Control", "no-store");
  const method = request.method.toUpperCase();

  function issue(user: User, accessToken: string, refreshToken: string, status = 200): Response {
    responseHeaders.set("Set-Cookie", formatRefreshCookie(refreshToken, config.production, false));
    responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify({ user, accessToken, expiresIn: ACCESS_SECONDS }), {
      status,
      headers: responseHeaders,
    });
  }

  async function limit(email: string): Promise<void> {
    if (!await store.reserveAttempt(hashToken(`auth-email:${email}`))) {
      throw new HttpError(429, "Too many attempts. Try again later.");
    }
  }

  const recordBody = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined;

  if (method === "POST" && subpath === "/register") {
    const email = emailFrom(recordBody);
    const name = typeof recordBody?.name === "string" ? recordBody.name.trim() : "";
    const password = recordBody?.password;
    if (!email || !name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name) || !validPassword(password)) {
      throw new HttpError(400, "Provide a name (1–100 characters), valid email, and password (12–128 characters, at most 512 UTF-8 bytes)");
    }
    await limit(email);
    const passwordHash = await hashPassword(password);
    const accessToken = newToken();
    const refreshToken = newToken();
    const user = await store.register(name, email, passwordHash, {
      accessHash: hashToken(accessToken),
      refreshHash: hashToken(refreshToken),
    });
    if (!user) throw new HttpError(400, "Unable to register with these details");
    return issue(user, accessToken, refreshToken, 201);
  }

  if (method === "POST" && subpath === "/login") {
    const email = emailFrom(recordBody);
    if (!email) throw new HttpError(401, "Invalid email or password");
    await limit(email);
    const password = recordBody?.password;
    if (!validPassword(password)) throw new HttpError(401, "Invalid email or password");
    const account = await store.findAccount(email);
    const valid = await verifyPassword(password, account?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!account || !valid) throw new HttpError(401, "Invalid email or password");
    const accessToken = newToken();
    const refreshToken = newToken();
    await store.createSession(account.id, {
      accessHash: hashToken(accessToken),
      refreshHash: hashToken(refreshToken),
    });
    const { passwordHash: _passwordHash, ...user } = account;
    return issue(user, accessToken, refreshToken, 200);
  }

  if (method === "POST" && subpath === "/refresh") {
    const cookies = refreshCookiesFromHeader(request.headers.get("cookie"));
    if (cookies.length !== 1) {
      responseHeaders.set("Set-Cookie", formatRefreshCookie("", config.production, true));
      throw new HttpError(401, "Authentication required");
    }
    const accessToken = newToken();
    const refreshToken = newToken();
    const user = await store.rotate(hashToken(cookies[0]), {
      accessHash: hashToken(accessToken),
      refreshHash: hashToken(refreshToken),
    });
    if (!user) {
      responseHeaders.set("Set-Cookie", formatRefreshCookie("", config.production, true));
      throw new HttpError(401, "Authentication required");
    }
    return issue(user, accessToken, refreshToken, 200);
  }

  if (method === "POST" && subpath === "/logout") {
    // Clear even if the database is unavailable; report a failure, never a false 204.
    responseHeaders.set("Set-Cookie", formatRefreshCookie("", config.production, true));
    const cookies = refreshCookiesFromHeader(request.headers.get("cookie"));
    const accessToken = bearerTokenFromHeader(request.headers.get("authorization"));
    if (cookies.length === 0) {
      if (accessToken) await store.revoke(undefined, hashToken(accessToken));
    } else {
      for (const cookie of new Set(cookies)) {
        await store.revoke(hashToken(cookie), accessToken ? hashToken(accessToken) : undefined);
      }
    }
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  if ((method === "GET" || method === "HEAD") && subpath === "/me") {
    const user = await authenticateRequest(request, store);
    responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    return new Response(method === "HEAD" ? null : JSON.stringify({ user }), {
      status: 200,
      headers: responseHeaders,
    });
  }

  if (subpath === "/api-keys") {
    const user = await authenticateRequest(request, store);
    if (method === "GET" || method === "HEAD") {
      const apiKeys = store.listApiKeys ? await store.listApiKeys(user.id) : [];
      responseHeaders.set("Content-Type", "application/json; charset=utf-8");
      return new Response(method === "HEAD" ? null : JSON.stringify({ apiKeys }), {
        status: 200,
        headers: responseHeaders,
      });
    }
    if (method === "POST") {
      if (!store.createApiKey) throw new HttpError(501, "API key management not supported");
      const rawName = typeof recordBody?.name === "string" ? recordBody.name.trim() : "";
      if (!rawName || rawName.length > 100 || /[\u0000-\u001f\u007f]/.test(rawName)) {
        throw new HttpError(400, "Provide a token name (1–100 characters)");
      }
      let expiresAt: string | null = null;
      if (recordBody?.expiresInDays !== undefined && recordBody?.expiresInDays !== null) {
        const days = recordBody.expiresInDays;
        if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 3650) {
          throw new HttpError(400, "Invalid expiresInDays (1–3650)");
        }
        expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
      }
      const existing = store.listApiKeys ? await store.listApiKeys(user.id) : [];
      if (existing.length >= 25) {
        throw new HttpError(400, "Maximum of 25 active personal access tokens reached");
      }
      const secret = newApiKey();
      const keyPrefix = `${secret.slice(0, 11)}…${secret.slice(-4)}`;
      const rawScope = recordBody?.scope;
      if (rawScope !== undefined && rawScope !== "read" && rawScope !== "write") {
        throw new HttpError(400, "Invalid scope (expected 'read' or 'write')");
      }
      const scope: ApiKeyScope = rawScope === "read" ? "read" : "write";
      const apiKey = await store.createApiKey(user.id, {
        name: rawName,
        keyPrefix,
        keyHash: hashToken(secret),
        scope,
        expiresAt,
      });
      responseHeaders.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify({ apiKey, secret }), {
        status: 201,
        headers: responseHeaders,
      });
    }
  }

  const apiKeyMatch = /^\/api-keys\/([^/]+)$/.exec(subpath);
  if (apiKeyMatch && method === "DELETE") {
    const user = await authenticateRequest(request, store);
    if (!store.revokeApiKey) throw new HttpError(501, "API key management not supported");
    const rawId = decodeURIComponent(apiKeyMatch[1]);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
      throw new HttpError(404, "Personal access token not found");
    }
    const revoked = await store.revokeApiKey(user.id, rawId.toLowerCase());
    if (!revoked) throw new HttpError(404, "Personal access token not found");
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  throw new HttpError(404, "Not found");
}
