/**
 * Bidirectional JSON-RPC 2.0 Protocol Engine and Message Framer.
 *
 * Implements standard JSON-RPC 2.0 request/response correlation, notifications,
 * standard error codes (-32700..-32600), and streaming NDJSON message framing.
 *
 * @module jsonRpcStreamProtocol
 */

export interface JsonRpcRequest<TParams = unknown> {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly method: string;
  readonly params?: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: TParams;
}

export interface JsonRpcErrorObject<TData = unknown> {
  readonly code: number;
  readonly message: string;
  readonly data?: TData;
}

export interface JsonRpcSuccessResponse<TResult = unknown> {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly result: TResult;
}

export interface JsonRpcErrorResponse<TData = unknown> {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly error: JsonRpcErrorObject<TData>;
}

export type JsonRpcResponse<TResult = unknown, TData = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse<TData>;

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse;

export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_TIMEOUT: -32000,
} as const;

/**
 * Creates a standard JSON-RPC 2.0 Request message.
 */
export function createJsonRpcRequest<TParams = unknown>(
  id: string | number,
  method: string,
  params?: TParams,
): JsonRpcRequest<TParams> {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };
}

/**
 * Creates a standard JSON-RPC 2.0 Notification message (no ID, no response expected).
 */
export function createJsonRpcNotification<TParams = unknown>(
  method: string,
  params?: TParams,
): JsonRpcNotification<TParams> {
  return {
    jsonrpc: "2.0",
    method,
    params,
  };
}

/**
 * Creates a standard JSON-RPC 2.0 Success Response message.
 */
export function createJsonRpcSuccess<TResult = unknown>(
  id: string | number,
  result: TResult,
): JsonRpcSuccessResponse<TResult> {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

/**
 * Creates a standard JSON-RPC 2.0 Error Response message.
 */
export function createJsonRpcError<TData = unknown>(
  id: string | number | null,
  code: number,
  message: string,
  data?: TData,
): JsonRpcErrorResponse<TData> {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

/**
 * Parses a raw line or buffer chunk into a validated JSON-RPC 2.0 message.
 */
export function parseJsonRpcMessage(raw: string): {
  readonly success: boolean;
  readonly message?: JsonRpcMessage;
  readonly error?: JsonRpcErrorResponse;
} {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      success: false,
      error: createJsonRpcError(
        null,
        JSON_RPC_ERROR_CODES.PARSE_ERROR,
        "Parse error: invalid JSON.",
      ),
    };
  }

  if (typeof parsed !== "object" || parsed === null || parsed.jsonrpc !== "2.0") {
    return {
      success: false,
      error: createJsonRpcError(
        parsed?.id ?? null,
        JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        "Invalid Request: missing or invalid 'jsonrpc' version.",
      ),
    };
  }

  return {
    success: true,
    message: parsed as JsonRpcMessage,
  };
}

/**
 * Stateful connection message correlator matching pending request IDs with incoming responses.
 */
export class JsonRpcMessageRouter {
  private readonly pendingRequests: Map<
    string | number,
    {
      readonly resolve: (result: any) => void;
      readonly reject: (error: JsonRpcErrorObject) => void;
      readonly timeoutHandle?: NodeJS.Timeout;
    }
  > = new Map();

  private readonly methodHandlers: Map<string, (params: any) => Promise<any> | any> = new Map();

  public registerMethod(method: string, handler: (params: any) => Promise<any> | any): void {
    this.methodHandlers.set(method, handler);
  }

  public registerPendingRequest<T = any>(
    id: string | number,
    resolve: (val: T) => void,
    reject: (err: JsonRpcErrorObject) => void,
    timeoutMs = 15_000,
  ): void {
    const timeoutHandle = setTimeout(() => {
      this.pendingRequests.delete(id);
      reject({
        code: JSON_RPC_ERROR_CODES.SERVER_TIMEOUT,
        message: `Request '${id}' timed out after ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    this.pendingRequests.set(id, { resolve, reject, timeoutHandle });
  }

  public async handleIncoming(message: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    // 1. Success Response
    if ("result" in message && "id" in message) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        if (pending.timeoutHandle) clearTimeout(pending.timeoutHandle);
        this.pendingRequests.delete(message.id);
        pending.resolve(message.result);
      }
      return null;
    }

    // 2. Error Response
    if ("error" in message && "id" in message && message.id !== null) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        if (pending.timeoutHandle) clearTimeout(pending.timeoutHandle);
        this.pendingRequests.delete(message.id);
        pending.reject(message.error);
      }
      return null;
    }

    // 3. Request
    if ("method" in message && "id" in message) {
      const handler = this.methodHandlers.get(message.method);
      if (!handler) {
        return createJsonRpcError(
          message.id,
          JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
          `Method '${message.method}' not found.`,
        );
      }

      try {
        const result = await handler(message.params);
        return createJsonRpcSuccess(message.id, result);
      } catch (err: any) {
        return createJsonRpcError(
          message.id,
          JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
          err?.message ?? "Internal error.",
        );
      }
    }

    // 4. Notification
    if ("method" in message && !("id" in message)) {
      const handler = this.methodHandlers.get(message.method);
      if (handler) {
        try {
          await handler(message.params);
        } catch {
          // Notifications do not return errors
        }
      }
      return null;
    }

    return null;
  }

  public pendingCount(): number {
    return this.pendingRequests.size;
  }
}
