export const MCP_SERVER_INFO = {
  name: "my-finance-mcp",
  version: "1.0.0",
} as const;

export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-03-26",
  "2024-11-05",
] as const;

export const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

export const JSONRPC_VERSION = "2.0" as const;

export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export class McpError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  annotations?: McpToolAnnotations;
}

export interface McpToolCallResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpResourceTemplateDefinition {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpPromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface McpPromptDefinition {
  name: string;
  description: string;
  arguments?: McpPromptArgument[];
}

export interface McpPromptMessage {
  role: "user" | "assistant";
  content: {
    type: "text";
    text: string;
  };
}

export const MCP_SERVER_INSTRUCTIONS = [
  "MyFinance MCP Server gives AI agents authenticated access to a user's personal finance tracker.",
  "Currency: Amounts are denominated in VND (₫) or numeric decimal values (up to 2 decimal places).",
  "Dates use 'YYYY-MM-DD' format, months use 'YYYY-MM' format, and times use 24-hour 'HH:mm' format.",
  "Before creating or updating a spending or repeat rule, ensure the `category` ID exists in the user's settings (use `get_profile_and_settings` to inspect configured categories, or `upsert_category` to add a new category).",
].join(" ");
