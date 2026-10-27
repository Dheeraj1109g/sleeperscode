import { describe, expect, it } from "vite-plus/test";

import {
  createJsonRpcError,
  createJsonRpcNotification,
  createJsonRpcRequest,
  createJsonRpcSuccess,
  JSON_RPC_ERROR_CODES,
  JsonRpcMessageRouter,
  parseJsonRpcMessage,
} from "./jsonRpcStreamProtocol.ts";

describe("JSON-RPC Message Builders", () => {
  it("creates compliant request and notification messages", () => {
    const req = createJsonRpcRequest(1, "tools/list", { filter: "all" });
    expect(req.jsonrpc).toBe("2.0");
    expect(req.id).toBe(1);
    expect(req.method).toBe("tools/list");

    const notif = createJsonRpcNotification("telemetry/event", { cpu: 45 });
    expect(notif.jsonrpc).toBe("2.0");
    expect("id" in notif).toBe(false);
  });

  it("creates compliant success and error responses", () => {
    const succ = createJsonRpcSuccess(1, { tools: [] });
    expect(succ.result).toEqual({ tools: [] });

    const err = createJsonRpcError(1, JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, "Not found");
    expect(err.error.code).toBe(-32601);
  });
});

describe("parseJsonRpcMessage", () => {
  it("parses valid JSON-RPC string payloads", () => {
    const raw = JSON.stringify(createJsonRpcRequest("req-1", "workspace/status"));
    const res = parseJsonRpcMessage(raw);
    expect(res.success).toBe(true);
    expect(res.message?.method).toBe("workspace/status");
  });

  it("flags malformed JSON as parse errors", () => {
    const res = parseJsonRpcMessage("invalid { json");
    expect(res.success).toBe(false);
    expect(res.error?.error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);
  });
});

describe("JsonRpcMessageRouter", () => {
  it("routes incoming requests to registered handlers", async () => {
    const router = new JsonRpcMessageRouter();
    router.registerMethod("agent/version", () => ({ version: "1.0.0" }));

    const req = createJsonRpcRequest("msg-1", "agent/version");
    const response = await router.handleIncoming(req);

    expect(response).toBeDefined();
    expect((response as any).result).toEqual({ version: "1.0.0" });
  });

  it("resolves pending request promises when success response arrives", async () => {
    const router = new JsonRpcMessageRouter();

    const promise = new Promise((resolve, reject) => {
      router.registerPendingRequest("call-100", resolve, reject);
    });

    const succ = createJsonRpcSuccess("call-100", { answer: 42 });
    await router.handleIncoming(succ);

    const result = await promise;
    expect(result).toEqual({ answer: 42 });
  });

  it("returns method not found for unregistered methods", async () => {
    const router = new JsonRpcMessageRouter();
    const req = createJsonRpcRequest("msg-2", "unknown/action");
    const response = await router.handleIncoming(req);

    expect((response as any).error.code).toBe(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
  });
});
