import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Config } from "./config";
import type { AuthStore } from "./auth/store";
import { handleAuthRequest, HttpError } from "./auth/http";
import { serviceErrorDiagnostic } from "./service-error";
import { handleFinanceRequest } from "./finance/http";
import type { FinanceStore } from "./finance/store";
import { handleMcpRequest } from "./mcp/http";
import { JsonRpcErrorCode } from "./mcp/protocol";

export interface Application {
  fetch(request: Request): Promise<Response>;
  listen(port?: number, hostname?: string, listeningListener?: () => void): Server;
}

class PayloadError extends Error {
  constructor(public readonly status: 400 | 413) {
    super("Invalid JSON request body");
  }
}

async function parseJsonBody(request: Request, limitBytes: number): Promise<unknown> {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return undefined;
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > limitBytes) throw new PayloadError(413);
  if (buffer.byteLength === 0) return {};
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return {};
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const trimmed = text.trimStart();
  if (trimmed.length > 0 && trimmed[0] !== "{" && trimmed[0] !== "[") {
    throw new PayloadError(400);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PayloadError(400);
  }
}

function sendJson(status: number, body: unknown, headers: Headers, headOnly = false): Response {
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(headOnly ? null : JSON.stringify(body), { status, headers });
}

export function createApplication(config: Config, store: AuthStore, financeStore?: FinanceStore): Application {
  async function handleFetch(request: Request): Promise<Response> {
    const method = request.method.toUpperCase();
    const headOnly = method === "HEAD";
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname.length > 1 && url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;

    const isMcpRoute = Boolean(
      financeStore && (pathname === "/api/mcp" || pathname === "/api/v1/mcp"),
    );

    const responseHeaders = new Headers({
      "Access-Control-Allow-Origin": config.appOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Vary": "Origin",
    });

    if (method === "OPTIONS" && !isMcpRoute) {
      responseHeaders.set("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,DELETE,OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
      return new Response(null, { status: 204, headers: responseHeaders });
    }

    if (!isMcpRoute && !["GET", "HEAD", "OPTIONS"].includes(method) && request.headers.get("origin") !== config.appOrigin) {
      return sendJson(403, { error: "Origin not allowed" }, responseHeaders, headOnly);
    }

    const isFinanceRoute = Boolean(
      financeStore && (pathname === "/api/v1/finance" || pathname.startsWith("/api/v1/finance/")),
    );
    const limitBytes = isFinanceRoute || isMcpRoute ? 128 * 1024 : 16 * 1024;

    try {
      const body = await parseJsonBody(request, limitBytes);

      if (financeStore && isMcpRoute) {
        return await handleMcpRequest(request, body, store, financeStore, responseHeaders);
      }

      if ((method === "GET" || method === "HEAD") && (pathname === "/" || pathname === "/api" || pathname === "/api/v1/health")) {
        return sendJson(200, { status: "ok", timestamp: new Date().toISOString() }, responseHeaders, headOnly);
      }

      if (pathname === "/api/v1/auth" || pathname.startsWith("/api/v1/auth/")) {
        const subpath = pathname.slice("/api/v1/auth".length) || "/";
        return await handleAuthRequest(request, subpath, body, store, config, responseHeaders);
      }

      if (financeStore && isFinanceRoute) {
        const subpath = pathname.slice("/api/v1/finance".length) || "/";
        return await handleFinanceRequest(request, subpath, url, body, store, financeStore, responseHeaders);
      }

      return sendJson(404, { error: "Not found" }, responseHeaders, headOnly);
    } catch (error: unknown) {
      if (error instanceof PayloadError) {
        if (isMcpRoute) {
          return sendJson(
            error.status,
            {
              jsonrpc: "2.0",
              id: null,
              error: {
                code: error.status === 413 ? JsonRpcErrorCode.INVALID_REQUEST : JsonRpcErrorCode.PARSE_ERROR,
                message: error.status === 413 ? "Request payload too large" : "Parse error: invalid JSON request body",
              },
            },
            responseHeaders,
            headOnly,
          );
        }
        return sendJson(error.status, { error: "Invalid JSON request body" }, responseHeaders, headOnly);
      }
      if (error instanceof HttpError) {
        if (error.status === 429) responseHeaders.set("Retry-After", "900");
        return sendJson(error.status, { error: error.message }, responseHeaders, headOnly);
      }
      // Never log raw errors, bodies, headers, or URLs: they may contain credentials.
      console.error("Service request failed", serviceErrorDiagnostic(error));
      return sendJson(503, { error: "Service temporarily unavailable" }, responseHeaders, headOnly);
    }
  }

  function listen(port = 0, hostname?: string, listeningListener?: () => void): Server {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const bodyBuffer = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (Array.isArray(value)) {
            headers.set(key, value.join(key.toLowerCase() === "cookie" ? "; " : ", "));
          } else if (typeof value === "string") {
            headers.set(key, value);
          }
        }
        const method = (req.method ?? "GET").toUpperCase();
        const webReq = new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
          method,
          headers,
          body: ["GET", "HEAD", "OPTIONS"].includes(method) ? undefined : bodyBuffer,
        });
        const webRes = await handleFetch(webReq);
        res.statusCode = webRes.status;
        webRes.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        const arrayBuf = await webRes.arrayBuffer();
        res.end(Buffer.from(arrayBuf));
      } catch (error) {
        console.error("Service request failed", serviceErrorDiagnostic(error));
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "Service temporarily unavailable" }));
      }
    });
    return server.listen(port, hostname, listeningListener);
  }

  return { fetch: handleFetch, listen };
}
