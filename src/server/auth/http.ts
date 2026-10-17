import type { Config } from "../config";
import type { AuthStore, User } from "./store";
import {
  ACCESS_SECONDS,
  DUMMY_PASSWORD_HASH,
  REFRESH_SECONDS,
  hashPassword,
  hashToken,
  newToken,
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

function refreshCookiesFromHeader(cookieHeader: string | null | undefined): string[] {
  return (cookieHeader ?? "").split(";").flatMap(part => {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== REFRESH_COOKIE) return [];
    const value = part.slice(separator + 1).trim();
    return validToken(value) ? [value] : [];
  });
}

export async function authenticateRequest(request: Request, store: AuthStore): Promise<User> {
  const token = bearerTokenFromHeader(request.headers.get("authorization"));
  if (!token) throw new HttpError(401, "Authentication required");
  const account = await store.authenticate(hashToken(token));
  if (!account) throw new HttpError(401, "Authentication required");
  return account;
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

  throw new HttpError(404, "Not found");
}
