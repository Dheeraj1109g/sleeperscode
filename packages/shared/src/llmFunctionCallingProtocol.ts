/**
 * Multi-Provider LLM Function Calling and Tool Declaration Protocol Engine.
 *
 * Implements schema generation and validation for Google Gemini, OpenAI,
 * and Anthropic tool calling specifications, with parameter type checking and response serialization.
 *
 * @module llmFunctionCallingProtocol
 */

export type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export interface JsonSchemaProperty {
  readonly type: JsonSchemaType;
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly items?: JsonSchemaProperty;
  readonly properties?: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
  readonly default?: unknown;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
    readonly required?: readonly string[];
  };
}

export interface OpenAiFunctionDeclaration {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: {
      readonly type: "object";
      readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
      readonly required?: readonly string[];
    };
  };
}

export interface GeminiFunctionDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters?: {
    readonly type: "object" | "OBJECT";
    readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
    readonly required?: readonly string[];
  };
}

export interface AnthropicToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly input_schema: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
    readonly required?: readonly string[];
  };
}

export interface ParsedToolCall {
  readonly toolName: string;
  readonly callId?: string;
  readonly rawArguments: string | Readonly<Record<string, unknown>>;
  readonly parsedArguments: Readonly<Record<string, unknown>>;
}

export interface ToolValidationResult {
  readonly isValid: boolean;
  readonly toolName: string;
  readonly validatedArguments?: Readonly<Record<string, unknown>>;
  readonly errors: readonly string[];
}

export interface ToolExecutionResponse {
  readonly toolName: string;
  readonly callId?: string;
  readonly success: boolean;
  readonly output?: unknown;
  readonly error?: string;
  readonly executionTimeMs?: number;
}

/**
 * Converts internal tool definition into OpenAI function calling format.
 */
export function toOpenAiFormat(tool: ToolDefinition): OpenAiFunctionDeclaration {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    },
  };
}

/**
 * Converts internal tool definition into Google Gemini function declaration format.
 */
export function toGeminiFormat(tool: ToolDefinition): GeminiFunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "OBJECT",
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  };
}

/**
 * Converts internal tool definition into Anthropic Claude tool declaration format.
 */
export function toAnthropicFormat(tool: ToolDefinition): AnthropicToolDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  };
}

/**
 * Validates tool call arguments against declared schema properties.
 */
export function validateToolArguments(
  tool: ToolDefinition,
  rawArgs: unknown,
): ToolValidationResult {
  const errors: string[] = [];

  let argsObj: Record<string, unknown>;
  if (typeof rawArgs === "string") {
    try {
      argsObj = JSON.parse(rawArgs);
    } catch {
      return {
        isValid: false,
        toolName: tool.name,
        errors: ["Arguments string is not valid JSON."],
      };
    }
  } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    argsObj = { ...(rawArgs as Record<string, unknown>) };
  } else {
    return {
      isValid: false,
      toolName: tool.name,
      errors: ["Tool arguments must be an object."],
    };
  }

  const schemaProps = tool.parameters.properties;
  const requiredKeys = tool.parameters.required ?? [];
  const validatedArgs: Record<string, unknown> = {};

  // Check required fields
  for (const reqKey of requiredKeys) {
    if (argsObj[reqKey] === undefined || argsObj[reqKey] === null) {
      errors.push(`Missing required property '${reqKey}'.`);
    }
  }

  // Type-check provided fields
  for (const [propName, propSchema] of Object.entries(schemaProps)) {
    const val = argsObj[propName];

    if (val === undefined) {
      if (propSchema.default !== undefined) {
        validatedArgs[propName] = propSchema.default;
      }
      continue;
    }

    const typeError = checkPropertyType(propName, val, propSchema);
    if (typeError) {
      errors.push(typeError);
    } else {
      validatedArgs[propName] = val;
    }
  }

  return {
    isValid: errors.length === 0,
    toolName: tool.name,
    validatedArguments: errors.length === 0 ? validatedArgs : undefined,
    errors,
  };
}

function checkPropertyType(name: string, val: unknown, schema: JsonSchemaProperty): string | null {
  switch (schema.type) {
    case "string":
      if (typeof val !== "string")
        return `Property '${name}' expected string, received ${typeof val}.`;
      if (schema.enum && !schema.enum.includes(val)) {
        return `Property '${name}' value '${val}' is not in allowed enum [${schema.enum.join(", ")}].`;
      }
      return null;

    case "number":
      if (typeof val !== "number" || !Number.isFinite(val)) {
        return `Property '${name}' expected finite number, received ${typeof val}.`;
      }
      return null;

    case "integer":
      if (typeof val !== "number" || !Number.isInteger(val)) {
        return `Property '${name}' expected integer, received ${typeof val}.`;
      }
      return null;

    case "boolean":
      if (typeof val !== "boolean")
        return `Property '${name}' expected boolean, received ${typeof val}.`;
      return null;

    case "array":
      if (!Array.isArray(val)) return `Property '${name}' expected array, received ${typeof val}.`;
      return null;

    case "object":
      if (typeof val !== "object" || val === null || Array.isArray(val)) {
        return `Property '${name}' expected object, received ${typeof val}.`;
      }
      return null;

    default:
      return null;
  }
}

/**
 * Serializes tool execution result for delivery back to model turn context.
 */
export function formatToolResponse(
  provider: "google" | "openai" | "anthropic",
  response: ToolExecutionResponse,
): Record<string, unknown> {
  const payload = response.success
    ? { output: response.output }
    : { error: response.error ?? "Tool execution failed." };

  if (provider === "google") {
    return {
      functionResponse: {
        name: response.toolName,
        response: payload,
      },
    };
  }

  if (provider === "anthropic") {
    return {
      type: "tool_result",
      tool_use_id: response.callId ?? `tool-${Date.now()}`,
      content: JSON.stringify(payload),
      is_error: !response.success,
    };
  }

  // OpenAI format
  return {
    role: "tool",
    tool_call_id: response.callId ?? `call-${Date.now()}`,
    name: response.toolName,
    content: JSON.stringify(payload),
  };
}
