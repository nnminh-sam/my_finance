import { randomUUID } from "node:crypto";
import { authenticateRequestWithScope, HttpError } from "../auth/http";
import type { ApiKeyScope, AuthStore, User } from "../auth/store";
import type { FinanceStore } from "../finance/store";
import { serviceErrorDiagnostic } from "../service-error";
import { getMcpPrompt, MCP_PROMPTS } from "./prompts";
import {
  DEFAULT_PROTOCOL_VERSION,
  JSONRPC_VERSION,
  JsonRpcErrorCode,
  McpError,
  MCP_SERVER_INFO,
  MCP_SERVER_INSTRUCTIONS,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcErrorResponse,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcSuccessResponse,
} from "./protocol";
import { MCP_RESOURCE_TEMPLATES, MCP_RESOURCES, readMcpResource } from "./resources";
import { executeMcpTool, MCP_TOOLS } from "./tools";

function setMcpCorsHeaders(request: Request, headers: Headers): void {
  const origin = request.headers.get("origin");
  headers.set("Access-Control-Allow-Origin", origin ?? "*");
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,POST,DELETE,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-API-Key,Mcp-Session-Id,MCP-Protocol-Version,Accept",
  );
  headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id,MCP-Protocol-Version");
  headers.set("Cache-Control", "no-store");
}

function jsonRpcSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccessResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    result,
  };
}

function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: data !== undefined ? { code, message, data } : { code, message },
  };
}

async function dispatchJsonRpcMessage(
  rawMessage: unknown,
  user: User,
  scope: ApiKeyScope,
  financeStore: FinanceStore,
  sessionOut: { sessionId?: string },
): Promise<JsonRpcResponse | null> {
  if (!rawMessage || typeof rawMessage !== "object" || Array.isArray(rawMessage)) {
    return jsonRpcError(null, JsonRpcErrorCode.INVALID_REQUEST, "Invalid JSON-RPC request object");
  }

  const msg = rawMessage as Record<string, unknown>;
  const hasId = Object.hasOwn(msg, "id") && msg.id !== undefined;
  const id: JsonRpcId = typeof msg.id === "string" || typeof msg.id === "number" || msg.id === null
    ? msg.id
    : null;

  if (msg.jsonrpc !== JSONRPC_VERSION || typeof msg.method !== "string" || !msg.method.trim()) {
    return jsonRpcError(id, JsonRpcErrorCode.INVALID_REQUEST, "Invalid JSON-RPC 2.0 request");
  }

  const method = msg.method;
  const params = msg.params !== undefined
    ? (msg.params && typeof msg.params === "object" && !Array.isArray(msg.params)
        ? (msg.params as Record<string, unknown>)
        : undefined)
    : {};

  if (params === undefined) {
    return jsonRpcError(id, JsonRpcErrorCode.INVALID_PARAMS, "JSON-RPC params must be an object");
  }

  // Notifications (no `id` property) do not produce a JSON-RPC response object.
  if (!hasId) {
    return null;
  }

  try {
    switch (method) {
      case "initialize": {
        const requestedVersion = typeof params.protocolVersion === "string"
          ? params.protocolVersion
          : DEFAULT_PROTOCOL_VERSION;
        const negotiatedVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requestedVersion)
          ? requestedVersion
          : DEFAULT_PROTOCOL_VERSION;
        if (!sessionOut.sessionId) {
          sessionOut.sessionId = randomUUID();
        }
        return jsonRpcSuccess(id, {
          protocolVersion: negotiatedVersion,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: MCP_SERVER_INFO,
          instructions: MCP_SERVER_INSTRUCTIONS,
        });
      }

      case "ping": {
        return jsonRpcSuccess(id, {});
      }

      case "tools/list": {
        return jsonRpcSuccess(id, {
          tools: MCP_TOOLS,
        });
      }

      case "tools/call": {
        const toolName = typeof params.name === "string" ? params.name : "";
        if (!toolName) {
          throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, "Missing required parameter: name");
        }
        const toolDef = MCP_TOOLS.find(t => t.name === toolName);
        if (scope === "read" && toolDef && !toolDef.annotations?.readOnlyHint) {
          return jsonRpcSuccess(id, {
            content: [{ type: "text", text: JSON.stringify({ error: `Tool '${toolName}' requires a token with 'write' scope.` }, null, 2) }],
            structuredContent: { error: `Tool '${toolName}' requires a token with 'write' scope.` },
            isError: true,
          });
        }
        const toolArgs = params.arguments !== undefined
          ? (params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
              ? (params.arguments as Record<string, unknown>)
              : undefined)
          : {};
        if (toolArgs === undefined) {
          throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, "Tool arguments must be an object");
        }
        const result = await executeMcpTool(toolName, toolArgs, user, financeStore);
        return jsonRpcSuccess(id, result);
      }

      case "resources/list": {
        return jsonRpcSuccess(id, {
          resources: MCP_RESOURCES,
        });
      }

      case "resources/templates/list": {
        return jsonRpcSuccess(id, {
          resourceTemplates: MCP_RESOURCE_TEMPLATES,
        });
      }

      case "resources/read": {
        const uri = typeof params.uri === "string" ? params.uri.trim() : "";
        if (!uri) {
          throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, "Missing required parameter: uri");
        }
        const result = await readMcpResource(uri, user, financeStore);
        return jsonRpcSuccess(id, result);
      }

      case "prompts/list": {
        return jsonRpcSuccess(id, {
          prompts: MCP_PROMPTS,
        });
      }

      case "prompts/get": {
        const promptName = typeof params.name === "string" ? params.name.trim() : "";
        if (!promptName) {
          throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, "Missing required parameter: name");
        }
        const promptArgs = params.arguments !== undefined
          ? (params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
              ? (params.arguments as Record<string, unknown>)
              : undefined)
          : {};
        if (promptArgs === undefined) {
          throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, "Prompt arguments must be an object");
        }
        const result = await getMcpPrompt(promptName, promptArgs, user, financeStore);
        return jsonRpcSuccess(id, result);
      }

      case "completion/complete": {
        return jsonRpcSuccess(id, {
          completion: {
            values: [],
            total: 0,
            hasMore: false,
          },
        });
      }

      case "logging/setLevel": {
        return jsonRpcSuccess(id, {});
      }

      default:
        return jsonRpcError(id, JsonRpcErrorCode.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      return jsonRpcError(id, error.code, error.message, error.data);
    }
    if (error instanceof HttpError) {
      return jsonRpcError(id, JsonRpcErrorCode.INVALID_PARAMS, error.message);
    }
    console.error("MCP request execution failed", serviceErrorDiagnostic(error));
    return jsonRpcError(id, JsonRpcErrorCode.INTERNAL_ERROR, "Internal server error");
  }
}

export async function handleMcpRequest(
  request: Request,
  body: unknown,
  authStore: AuthStore,
  financeStore: FinanceStore,
  responseHeaders: Headers,
): Promise<Response> {
  const method = request.method.toUpperCase();
  setMcpCorsHeaders(request, responseHeaders);

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  let user: User;
  let scope: ApiKeyScope;
  try {
    const auth = await authenticateRequestWithScope(request, authStore);
    user = auth.user;
    scope = auth.scope;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      responseHeaders.set("WWW-Authenticate", 'Bearer realm="my-finance-mcp"');
      responseHeaders.set("Content-Type", "application/json; charset=utf-8");
      return new Response(
        method === "HEAD"
          ? null
          : JSON.stringify(
              jsonRpcError(
                null,
                -32001,
                "Authentication required. Provide an Authorization: Bearer <personal-access-token> or X-API-Key header.",
              ),
            ),
        { status: 401, headers: responseHeaders },
      );
    }
    throw error;
  }

  const incomingSessionId = request.headers.get("mcp-session-id") ?? undefined;
  if (incomingSessionId) {
    responseHeaders.set("Mcp-Session-Id", incomingSessionId);
  }

  if (method === "DELETE") {
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  if (method === "GET" || method === "HEAD") {
    const accept = (request.headers.get("accept") ?? "").toLowerCase();
    if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
      responseHeaders.set("Content-Type", "text/event-stream; charset=utf-8");
      return new Response(method === "HEAD" ? null : ": mcp-stream-ready\n\n", {
        status: 200,
        headers: responseHeaders,
      });
    }
    responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    const discovery = {
      name: MCP_SERVER_INFO.name,
      version: MCP_SERVER_INFO.version,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      transport: "streamable-http",
      user: { id: user.id, name: user.name, email: user.email },
      capabilities: {
        tools: MCP_TOOLS.length,
        resources: MCP_RESOURCES.length,
        resourceTemplates: MCP_RESOURCE_TEMPLATES.length,
        prompts: MCP_PROMPTS.length,
      },
    };
    return new Response(method === "HEAD" ? null : JSON.stringify(discovery), {
      status: 200,
      headers: responseHeaders,
    });
  }

  if (method !== "POST") {
    responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    return new Response(
      JSON.stringify(jsonRpcError(null, JsonRpcErrorCode.INVALID_REQUEST, `Method ${method} not supported`)),
      { status: 405, headers: responseHeaders },
    );
  }

  const sessionOut = { sessionId: incomingSessionId };

  if (Array.isArray(body)) {
    if (body.length === 0) {
      responseHeaders.set("Content-Type", "application/json; charset=utf-8");
      return new Response(
        JSON.stringify(jsonRpcError(null, JsonRpcErrorCode.INVALID_REQUEST, "Empty JSON-RPC batch")),
        { status: 400, headers: responseHeaders },
      );
    }
    const responses: JsonRpcResponse[] = [];
    for (const item of body) {
      const res = await dispatchJsonRpcMessage(item, user, scope, financeStore, sessionOut);
      if (res !== null) responses.push(res);
    }
    if (sessionOut.sessionId) {
      responseHeaders.set("Mcp-Session-Id", sessionOut.sessionId);
    }
    if (responses.length === 0) {
      return new Response(null, { status: 202, headers: responseHeaders });
    }
    responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(responses), { status: 200, headers: responseHeaders });
  }

  const singleResponse = await dispatchJsonRpcMessage(
    body as JsonRpcRequest,
    user,
    scope,
    financeStore,
    sessionOut,
  );
  if (sessionOut.sessionId) {
    responseHeaders.set("Mcp-Session-Id", sessionOut.sessionId);
  }
  if (singleResponse === null) {
    return new Response(null, { status: 202, headers: responseHeaders });
  }

  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
    responseHeaders.set("Content-Type", "text/event-stream; charset=utf-8");
    const ssePayload = `event: message\ndata: ${JSON.stringify(singleResponse)}\n\n`;
    return new Response(ssePayload, { status: 200, headers: responseHeaders });
  }

  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(singleResponse), { status: 200, headers: responseHeaders });
}
