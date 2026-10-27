import { describe, expect, it } from "vite-plus/test";

import {
  matchCommandAutocomplete,
  parseCommandLine,
  STANDARD_AGENT_COMMANDS,
  validateCommand,
} from "./agentCommandValidator.ts";

describe("parseCommandLine", () => {
  it("parses command name, positional args, and boolean flags", () => {
    const parsed = parseCommandLine("/plan src/client --strict");
    expect(parsed.command).toBe("plan");
    expect(parsed.positionalArgs).toEqual(["src/client"]);
    expect(parsed.namedArgs).toEqual({ strict: true });
  });

  it("parses key-value parameters with type coercion", () => {
    const parsed = parseCommandLine("/goal --timeoutMinutes=45 --autoCommit=true --mode=fast");
    expect(parsed.command).toBe("goal");
    expect(parsed.namedArgs["timeoutMinutes"]).toBe(45);
    expect(parsed.namedArgs["autoCommit"]).toBe(true);
    expect(parsed.namedArgs["mode"]).toBe("fast");
  });

  it("handles leading and trailing whitespace safely", () => {
    const parsed = parseCommandLine("   /test   ");
    expect(parsed.command).toBe("test");
    expect(parsed.positionalArgs).toEqual([]);
  });
});

describe("validateCommand", () => {
  it("validates recognized command and applies default parameters", () => {
    const parsed = parseCommandLine("/plan");
    const result = validateCommand(parsed);

    expect(result.isValid).toBe(true);
    expect(result.commandDef?.command).toBe("plan");
    expect(result.validatedArgs?.["strict"]).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts command aliases (e.g. /p for /plan)", () => {
    const parsed = parseCommandLine("/p");
    const result = validateCommand(parsed);

    expect(result.isValid).toBe(true);
    expect(result.commandDef?.command).toBe("plan");
  });

  it("fails validation on unrecognized commands", () => {
    const parsed = parseCommandLine("/unknownCommand");
    const result = validateCommand(parsed);

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("Unrecognized slash command");
  });

  it("validates enum parameter constraints", () => {
    const valid = validateCommand(parseCommandLine("/audit --mode=deep"));
    expect(valid.isValid).toBe(true);

    const invalid = validateCommand(parseCommandLine("/audit --mode=unsupportedMode"));
    expect(invalid.isValid).toBe(false);
    expect(invalid.errors[0]).toContain("Invalid value 'unsupportedMode'");
  });
});

describe("matchCommandAutocomplete", () => {
  it("returns ranked suggestions matching input prefix", () => {
    const matches = matchCommandAutocomplete("pl");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.command).toBe("/plan");
  });

  it("returns all commands when query is empty", () => {
    const matches = matchCommandAutocomplete("");
    expect(matches.length).toBe(STANDARD_AGENT_COMMANDS.length);
  });
});
