import { describe, expect, it } from "vite-plus/test";

import { composePromptTemplate, STANDARD_PROMPT_FILTERS } from "./promptTemplateComposer.ts";

describe("composePromptTemplate", () => {
  it("interpolates simple and nested variables", () => {
    const tpl = "Hello {{user.name}}! Mode: {{mode}}";
    const res = composePromptTemplate(tpl, {
      user: { name: "Agent Antigravity" },
      mode: "autonomous",
    });
    expect(res).toBe("Hello Agent Antigravity! Mode: autonomous");
  });

  it("applies filter pipelines like uppercase, truncate, and codeblock", () => {
    const tpl = "Role: {{role | uppercase}}\nSnippet:\n{{code | codeblock:typescript}}";
    const res = composePromptTemplate(tpl, {
      role: "architect",
      code: "const x = 1;",
    });

    expect(res).toContain("Role: ARCHITECT");
    expect(res).toContain("```typescript\nconst x = 1;\n```");
  });

  it("renders conditional blocks with truthy and falsy branching", () => {
    const tpl = "{{#if hasErrors}}Fix the following errors:{{else}}Everything is green!{{/if}}";

    expect(composePromptTemplate(tpl, { hasErrors: true })).toBe("Fix the following errors:");
    expect(composePromptTemplate(tpl, { hasErrors: false })).toBe("Everything is green!");
  });

  it("iterates over arrays using {{#each}}", () => {
    const tpl = "Files:\n{{#each files}}- {{name}} ({{lines}} lines)\n{{/each}}";
    const res = composePromptTemplate(tpl, {
      files: [
        { name: "index.ts", lines: 120 },
        { name: "utils.ts", lines: 45 },
      ],
    });

    expect(res).toContain("- index.ts (120 lines)");
    expect(res).toContain("- utils.ts (45 lines)");
  });
});

describe("STANDARD_PROMPT_FILTERS", () => {
  it("formats json with clean indentation", () => {
    const formatted = STANDARD_PROMPT_FILTERS["json"]?.({ a: 1 });
    expect(formatted).toBe('{\n  "a": 1\n}');
  });

  it("truncates long strings with ellipsis", () => {
    const truncated = STANDARD_PROMPT_FILTERS["truncate"]?.("1234567890", "5");
    expect(truncated).toBe("12345...");
  });
});
