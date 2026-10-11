import { Router, type Request, type RequestHandler, type Response } from "express";
import type { Config } from "../config";
import type { AuthStore, User } from "./store";
import { ACCESS_SECONDS, DUMMY_PASSWORD_HASH, REFRESH_SECONDS, hashPassword, hashToken, newToken, validPassword, validToken, verifyPassword } from "./crypto";

export const REFRESH_COOKIE = "mf_refresh";
const COOKIE_PATH = "/api/v1/auth";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function asyncHandler(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { Promise.resolve().then(() => handler(req, res)).catch(next); };
}

export function bearerToken(req: Request): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.headers.authorization ?? "");
  return match?.[1];
}

function refreshCookies(req: Request): string[] {
  return (req.headers.cookie ?? "").split(";").flatMap(part => {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== REFRESH_COOKIE) return [];
    const value = part.slice(separator + 1).trim();
    return validToken(value) ? [value] : [];
  });
}


export function requireAuth(store: AuthStore): RequestHandler {
  return (req, res, next) => {
    const token = bearerToken(req);
    if (!token) return next(new HttpError(401, "Authentication required"));
    store.authenticate(hashToken(token)).then(account => {
      if (!account) return next(new HttpError(401, "Authentication required"));
      res.locals.user = account;
      next();
    }).catch(next);
  };
}

function emailFrom(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const email = (body as Record<string, unknown>).email;
  if (typeof email !== "string") return undefined;
  const normalized = email.trim().toLowerCase();
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

export function authRouter(store: AuthStore, config: Config): Router {
  const router = Router();
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: "lax" as const, path: COOKIE_PATH };
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

  function issue(res: Response, user: User, accessToken: string, refreshToken: string): void {
    res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions, maxAge: REFRESH_SECONDS * 1000 });
    res.json({ user, accessToken, expiresIn: ACCESS_SECONDS });
  }
  async function limit(email: string): Promise<void> {
    if (!await store.reserveAttempt(hashToken(`auth-email:${email}`))) throw new HttpError(429, "Too many attempts. Try again later.");
  }

  router.post("/register", asyncHandler(async (req, res) => {
    const email = emailFrom(req.body);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!email || !name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name) || !validPassword(req.body?.password)) {
      throw new HttpError(400, "Provide a name (1–100 characters), valid email, and password (12–128 characters, at most 512 UTF-8 bytes)");
    }
    await limit(email);
    const passwordHash = await hashPassword(req.body.password);
    const accessToken = newToken();
    const refreshToken = newToken();
    const user = await store.register(name, email, passwordHash, { accessHash: hashToken(accessToken), refreshHash: hashToken(refreshToken) });
    if (!user) throw new HttpError(400, "Unable to register with these details");
    res.status(201);
    issue(res, user, accessToken, refreshToken);
  }));

  router.post("/login", asyncHandler(async (req, res) => {
    const email = emailFrom(req.body);
    if (!email) throw new HttpError(401, "Invalid email or password");
    await limit(email);
    if (!validPassword(req.body?.password)) throw new HttpError(401, "Invalid email or password");
    const account = await store.findAccount(email);
    const valid = await verifyPassword(req.body.password, account?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!account || !valid) throw new HttpError(401, "Invalid email or password");
    const accessToken = newToken();
    const refreshToken = newToken();
    await store.createSession(account.id, { accessHash: hashToken(accessToken), refreshHash: hashToken(refreshToken) });
    const { passwordHash: _passwordHash, ...user } = account;
    issue(res, user, accessToken, refreshToken);
  }));

  router.post("/refresh", asyncHandler(async (req, res) => {
    const cookies = refreshCookies(req);
    if (cookies.length !== 1) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions);
      throw new HttpError(401, "Authentication required");
    }
    const accessToken = newToken();
    const refreshToken = newToken();
    const user = await store.rotate(hashToken(cookies[0]), { accessHash: hashToken(accessToken), refreshHash: hashToken(refreshToken) });
    if (!user) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions);
      throw new HttpError(401, "Authentication required");
    }
    issue(res, user, accessToken, refreshToken);
  }));

  router.post("/logout", asyncHandler(async (req, res) => {
    // Clear even if the database is unavailable; report a failure, never a false 204.
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    const cookies = refreshCookies(req);
    const accessToken = bearerToken(req);
    if (cookies.length === 0) {
      if (accessToken) await store.revoke(undefined, hashToken(accessToken));
    } else {
      for (const cookie of new Set(cookies)) await store.revoke(hashToken(cookie), accessToken ? hashToken(accessToken) : undefined);
    }
    res.status(204).end();
  }));

  router.get("/me", requireAuth(store), (_req, res) => { res.json({ user: res.locals.user }); });
  return router;
}
