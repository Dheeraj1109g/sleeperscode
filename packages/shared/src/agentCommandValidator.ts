/**
 * Agent Slash-Command Schema Validator and Autocomplete Matcher.
 *
 * Validates command syntax, parameter constraints, and permission requirements
 * for agent tools and slash commands (e.g. /plan, /goal, /audit, /test).
 *
 * @module agentCommandValidator
 */

export type CommandPermissionLevel = "read_only" | "workspace_write" | "danger_full_access";

export interface CommandParameterDef {
  readonly name: string;
  readonly type: "string" | "number" | "boolean" | "enum";
  readonly required?: boolean;
  readonly defaultValue?: unknown;
  readonly allowedValues?: readonly string[];
  readonly description: string;
}

export interface CommandDefinition {
  readonly command: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly permissionLevel: CommandPermissionLevel;
  readonly parameters?: readonly CommandParameterDef[];
}

export interface ParsedCommand {
  readonly command: string;
  readonly rawArguments: string;
  readonly positionalArgs: readonly string[];
  readonly namedArgs: Readonly<Record<string, unknown>>;
}

export interface CommandValidationResult {
  readonly isValid: boolean;
  readonly commandDef?: CommandDefinition;
  readonly validatedArgs?: Readonly<Record<string, unknown>>;
  readonly errors: readonly string[];
}

export interface AutocompleteMatch {
  readonly command: string;
  readonly description: string;
  readonly score: number;
}

/**
 * Standard Sleepers Code agent slash-command registry.
 */
export const STANDARD_AGENT_COMMANDS: readonly CommandDefinition[] = [
  {
    command: "plan",
    aliases: ["p"],
    description:
      "Generates an architectural implementation plan before executing code modifications.",
    permissionLevel: "read_only",
    parameters: [
      {
        name: "scope",
        type: "string",
        required: false,
        description: "Target module or feature directory",
      },
      {
        name: "strict",
        type: "boolean",
        defaultValue: true,
        description: "Enforce strict dependency boundary checks",
      },
    ],
  },
  {
    command: "goal",
    aliases: ["g"],
    description: "Sets an autonomous objective that executes continuously until completion.",
    permissionLevel: "workspace_write",
    parameters: [
      {
        name: "timeoutMinutes",
        type: "number",
        defaultValue: 60,
        description: "Maximum autonomous duration",
      },
      {
        name: "autoCommit",
        type: "boolean",
        defaultValue: false,
        description: "Automatically create commits on milestone completion",
      },
    ],
  },
  {
    command: "audit",
    description: "Runs open-source compliance and security checks.",
    permissionLevel: "read_only",
    parameters: [
      {
        name: "mode",
        type: "enum",
        allowedValues: ["quick", "deep", "dependencies"],
        defaultValue: "quick",
        description: "Audit inspection depth",
      },
    ],
  },
  {
    command: "test",
    aliases: ["t"],
    description: "Runs focused test suites against modified workspace packages.",
    permissionLevel: "read_only",
    parameters: [
      { name: "path", type: "string", required: false, description: "Specific test file path" },
      {
        name: "watch",
        type: "boolean",
        defaultValue: false,
        description: "Run test runner in continuous watch mode",
      },
    ],
  },
];

/**
 * Parses a raw slash-command line (e.g. "/plan --scope=web --strict=true") into structured parts.
 */
export function parseCommandLine(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  const parts = withoutSlash.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { command: "", rawArguments: "", positionalArgs: [], namedArgs: {} };
  }

  const command = parts[0]!.toLowerCase();
  const rawArguments = withoutSlash.slice(command.length).trim();
  const positionalArgs: string[] = [];
  const namedArgs: Record<string, unknown> = {};

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.startsWith("--")) {
      const eqIdx = part.indexOf("=");
      if (eqIdx !== -1) {
        const key = part.slice(2, eqIdx);
        const val = part.slice(eqIdx + 1);
        namedArgs[key] = coerceValue(val);
      } else {
        const key = part.slice(2);
        namedArgs[key] = true;
      }
    } else {
      positionalArgs.push(part);
    }
  }

  return { command, rawArguments, positionalArgs, namedArgs };
}

/**
 * Validates parsed command arguments against registered schema constraints.
 */
export function validateCommand(
  parsed: ParsedCommand,
  registry: readonly CommandDefinition[] = STANDARD_AGENT_COMMANDS,
): CommandValidationResult {
  const commandDef = registry.find(
    (def) =>
      def.command === parsed.command || (def.aliases && def.aliases.includes(parsed.command)),
  );

  if (!commandDef) {
    return {
      isValid: false,
      errors: [`Unrecognized slash command: /${parsed.command}`],
    };
  }

  const errors: string[] = [];
  const validatedArgs: Record<string, unknown> = {};
  const params = commandDef.parameters ?? [];

  for (const param of params) {
    const provided = parsed.namedArgs[param.name];
    if (provided === undefined) {
      if (param.required) {
        errors.push(`Missing required parameter: --${param.name}`);
      } else if (param.defaultValue !== undefined) {
        validatedArgs[param.name] = param.defaultValue;
      }
      continue;
    }

    if (param.type === "enum" && param.allowedValues) {
      if (!param.allowedValues.includes(String(provided))) {
        errors.push(
          `Invalid value '${provided}' for --${param.name}. Allowed: ${param.allowedValues.join(", ")}`,
        );
        continue;
      }
    }

    if (param.type === "number" && typeof provided !== "number") {
      errors.push(`Parameter --${param.name} must be a number`);
      continue;
    }

    if (param.type === "boolean" && typeof provided !== "boolean") {
      errors.push(`Parameter --${param.name} must be a boolean`);
      continue;
    }

    validatedArgs[param.name] = provided;
  }

  return {
    isValid: errors.length === 0,
    commandDef,
    validatedArgs: errors.length === 0 ? validatedArgs : undefined,
    errors,
  };
}

/**
 * Scores and returns autocomplete suggestions for a given input query.
 */
export function matchCommandAutocomplete(
  query: string,
  registry: readonly CommandDefinition[] = STANDARD_AGENT_COMMANDS,
): readonly AutocompleteMatch[] {
  const clean = query.trim().replace(/^\//, "").toLowerCase();
  if (!clean) {
    return registry.map((def) => ({
      command: `/${def.command}`,
      description: def.description,
      score: 1.0,
    }));
  }

  const matches: AutocompleteMatch[] = [];

  for (const def of registry) {
    let score = 0;
    if (def.command === clean) {
      score = 1.0;
    } else if (def.command.startsWith(clean)) {
      score = 0.8 + (clean.length / def.command.length) * 0.2;
    } else if (def.aliases?.some((a) => a === clean)) {
      score = 0.9;
    } else if (def.command.includes(clean)) {
      score = 0.5;
    }

    if (score > 0) {
      matches.push({
        command: `/${def.command}`,
        description: def.description,
        score: Number(score.toFixed(2)),
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

function coerceValue(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  const num = Number(val);
  if (!Number.isNaN(num) && String(num) === val) return num;
  return val;
}
