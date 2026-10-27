import { describe, expect, it } from "vite-plus/test";

import {
  formatToolResponse,
  toAnthropicFormat,
  toGeminiFormat,
  toOpenAiFormat,
  type ToolDefinition,
  validateToolArguments,
} from "./llmFunctionCallingProtocol.ts";

const MOCK_TOOL: ToolDefinition = {
  name: "search_codebase",
  description: "Performs regex or semantic search across codebase files.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query string" },
      maxResults: { type: "integer", description: "Max results count", default: 10 },
      mode: { type: "string", enum: ["exact", "regex", "fuzzy"], default: "exact" },
      caseSensitive: { type: "boolean", default: false },
    },
    required: ["query"],
  },
};

describe("Tool Schema Exporters", () => {
  it("exports valid OpenAI function definition", () => {
    const openAi = toOpenAiFormat(MOCK_TOOL);
    expect(openAi.type).toBe("function");
    expect(openAi.function.name).toBe("search_codebase");
    expect(openAi.function.parameters.required).toContain("query");
  });

  it("exports valid Google Gemini function declaration", () => {
    const gemini = toGeminiFormat(MOCK_TOOL);
    expect(gemini.name).toBe("search_codebase");
    expect(gemini.parameters?.type).toBe("OBJECT");
    expect(gemini.parameters?.properties["query"]?.type).toBe("string");
  });

  it("exports valid Anthropic Claude tool declaration", () => {
    const claude = toAnthropicFormat(MOCK_TOOL);
    expect(claude.name).toBe("search_codebase");
    expect(claude.input_schema.type).toBe("object");
    expect(claude.input_schema.properties["query"]?.type).toBe("string");
  });
});

describe("validateToolArguments", () => {
  it("validates correct arguments and populates defaults", () => {
    const validArgs = { query: "export function" };
    const res = validateToolArguments(MOCK_TOOL, validArgs);

    expect(res.isValid).toBe(true);
    expect(res.validatedArguments?.["query"]).toBe("export function");
    expect(res.validatedArguments?.["maxResults"]).toBe(10); // default
    expect(res.validatedArguments?.["mode"]).toBe("exact"); // default
    expect(res.errors).toHaveLength(0);
  });

  it("parses valid JSON string arguments seamlessly", () => {
    const rawJson = JSON.stringify({ query: "import", mode: "regex", maxResults: 5 });
    const res = validateToolArguments(MOCK_TOOL, rawJson);

    expect(res.isValid).toBe(true);
    expect(res.validatedArguments?.["query"]).toBe("import");
    expect(res.validatedArguments?.["mode"]).toBe("regex");
    expect(res.validatedArguments?.["maxResults"]).toBe(5);
  });

  it("flags missing required properties", () => {
    const res = validateToolArguments(MOCK_TOOL, {});
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain("Missing required property 'query'");
  });

  it("validates enum value restrictions", () => {
    const res = validateToolArguments(MOCK_TOOL, { query: "test", mode: "unsupported" });
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain("is not in allowed enum");
  });

  it("flags invalid types for numbers and booleans", () => {
    const res = validateToolArguments(MOCK_TOOL, {
      query: "test",
      maxResults: "five",
      caseSensitive: "yes",
    });
    expect(res.isValid).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("formatToolResponse", () => {
  it("formats Google function response structure", () => {
    const res = formatToolResponse("google", {
      toolName: "search_codebase",
      success: true,
      output: { count: 3, matches: ["file1.ts", "file2.ts"] },
    });
    expect(res["functionResponse"]).toBeDefined();
  });

  it("formats Anthropic tool_result structure", () => {
    const res = formatToolResponse("anthropic", {
      toolName: "search_codebase",
      callId: "tool-call-123",
      success: true,
      output: "done",
    });
    expect(res["type"]).toBe("tool_result");
    expect(res["tool_use_id"]).toBe("tool-call-123");
    expect(res["is_error"]).toBe(false);
  });

  it("formats OpenAI tool response structure", () => {
    const res = formatToolResponse("openai", {
      toolName: "search_codebase",
      callId: "call-999",
      success: false,
      error: "Timeout error",
    });
    expect(res["role"]).toBe("tool");
    expect(res["tool_call_id"]).toBe("call-999");
  });
});
