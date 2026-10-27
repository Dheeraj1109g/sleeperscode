import { describe, expect, it } from "vite-plus/test";

import { analyzeSourceCode, detectLanguage } from "./codeASTTokenParser.ts";

describe("detectLanguage", () => {
  it("detects languages from extensions accurately", () => {
    expect(detectLanguage("src/App.tsx")).toBe("typescript");
    expect(detectLanguage("scripts/runner.mjs")).toBe("javascript");
    expect(detectLanguage("backend/main.py")).toBe("python");
    expect(detectLanguage("crates/sidecar/src/lib.rs")).toBe("rust");
    expect(detectLanguage("config/settings.json")).toBe("json");
    expect(detectLanguage("file.xyz")).toBe("unknown");
  });
});

describe("analyzeSourceCode", () => {
  it("counts code lines, comments, and blanks accurately", () => {
    const code = `
// First comment line
/* Block comment start
   Block comment continuation */

export function calculateSum(a: number, b: number): number {
  if (a > 0 && b > 0) {
    return a + b;
  }
  return 0;
}
`;
    const metrics = analyzeSourceCode(code, "typescript");

    expect(metrics.commentLines).toBe(3);
    expect(metrics.blankLines).toBe(3);
    expect(metrics.sourceLinesOfCode).toBeGreaterThanOrEqual(6);
    expect(metrics.cyclomaticComplexity).toBeGreaterThan(1); // includes if, &&
  });

  it("extracts exported functions, classes, interfaces, and types", () => {
    const code = `
import { expect } from "vite-plus/test";

export interface UserProfile {
  id: string;
}

export type UserRole = "admin" | "member";

export class UserService {
  getUser() {}
}

export function fetchUser(id: string) {}

const computeHash = (data: string) => data;
`;
    const metrics = analyzeSourceCode(code, "typescript");
    const symbols = metrics.symbols;

    const iface = symbols.find((s) => s.kind === "interface");
    expect(iface?.name).toBe("UserProfile");
    expect(iface?.isExported).toBe(true);

    const typeSym = symbols.find((s) => s.kind === "type");
    expect(typeSym?.name).toBe("UserRole");

    const cls = symbols.find((s) => s.kind === "class");
    expect(cls?.name).toBe("UserService");

    const fn = symbols.find((s) => s.kind === "function" && s.name === "fetchUser");
    expect(fn).toBeDefined();
    expect(fn?.isExported).toBe(true);
  });

  it("extracts Python functions and classes", () => {
    const pyCode = `
# Python module
class ModelRegistry:
    def __init__(self):
        pass

def run_prediction(data):
    if data:
        return True
`;
    const metrics = analyzeSourceCode(pyCode, "python");
    const symbols = metrics.symbols;

    expect(symbols.some((s) => s.name === "ModelRegistry" && s.kind === "class")).toBe(true);
    expect(symbols.some((s) => s.name === "run_prediction" && s.kind === "function")).toBe(true);
  });
});
