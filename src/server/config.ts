import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const moduleDir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// Walk both locations: local tsx/Next.js dev and bundled production entrypoint.
const roots = new Set<string>();
for (const start of [process.cwd(), moduleDir]) {
  let directory = start;
  while (true) {
    if (existsSync(path.join(directory, "package.json"))) roots.add(directory);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}
for (const root of roots) {
  dotenv.config({ path: path.join(root, ".env") });
  dotenv.config({ path: path.join(root, "packages/server/.env") });
}

export interface Config {
  databaseUrl: string;
  appOrigin: string;
  production: boolean;
}

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = env.DATABASE_URL;
  try {
    const url = new URL(databaseUrl ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1)) throw new Error();
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }
  // vercel dev uses the development environment and serves the shared origin over HTTP.
  const production = env.NODE_ENV === "production" || (env.VERCEL === "1" && env.VERCEL_ENV !== "development");
  let appOrigin: string;
  try {
    const url = new URL(env.APP_ORIGIN ?? "http://localhost:5173");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    if (production && url.protocol !== "https:") throw new Error();
    appOrigin = url.origin;
  } catch {
    throw new Error("APP_ORIGIN must be a single HTTP(S) origin (HTTPS in production)");
  }
  return { databaseUrl: databaseUrl!, appOrigin, production };
}

let cachedConfig: Config | undefined;

export function getConfig(): Config {
  if (!cachedConfig) cachedConfig = parseConfig(process.env);
  return cachedConfig;
}

export const config: Config = {
  get databaseUrl() { return getConfig().databaseUrl; },
  get appOrigin() { return getConfig().appOrigin; },
  get production() { return getConfig().production; },
};
