import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import type { Config } from "./config";
import type { AuthStore } from "./auth/store";
import { authRouter, HttpError } from "./auth/http";
import { serviceErrorDiagnostic } from "./service-error";
import { financeRouter } from "./finance/http";
import type { FinanceStore } from "./finance/store";

export function createApplication(config: Config, store: AuthStore, financeStore?: FinanceStore) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({
    origin: config.appOrigin,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }));
  app.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin !== config.appOrigin) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    next();
  });
  // A full category list with bounded Unicode strings can exceed auth's limit.
  if (financeStore) app.use("/api/v1/finance", express.json({ limit: "128kb" }));
  app.use(express.json({ limit: "16kb" }));
  app.get(["/", "/api", "/api/v1/health"], (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.use("/api/v1/auth", authRouter(store, config));
  if (financeStore) app.use("/api/v1/finance", financeRouter(store, financeStore));
  app.use((_req, res) => { res.status(404).json({ error: "Not found" }); });
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof HttpError) {
      if (error.status === 429) res.setHeader("Retry-After", "900");
      res.status(error.status).json({ error: error.message });
      return;
    }
    const type = error && typeof error === "object" && "type" in error ? error.type : undefined;
    if (type === "entity.parse.failed" || type === "entity.too.large") {
      res.status(type === "entity.too.large" ? 413 : 400).json({ error: "Invalid JSON request body" });
      return;
    }
    // Never log raw errors, bodies, headers, or URLs: they may contain credentials.
    console.error("Service request failed", serviceErrorDiagnostic(error));
    res.status(503).json({ error: "Service temporarily unavailable" });
  };
  app.use(errorHandler);
  return app;
}
