/**
 * Template Composer and Variable Substitution Engine for Agent Prompts.
 *
 * Provides variable interpolation, conditional rendering ({{#if}} / {{else}}),
 * collection iteration ({{#each}}), and string pipeline filters (uppercase, truncate, indent, codeblock).
 *
 * @module promptTemplateComposer
 */

export type FilterFunction = (input: unknown, ...args: string[]) => string;

export interface TemplateContext {
  readonly [key: string]: unknown;
}

export const STANDARD_PROMPT_FILTERS: Readonly<Record<string, FilterFunction>> = {
  uppercase: (val: unknown) => String(val ?? "").toUpperCase(),
  lowercase: (val: unknown) => String(val ?? "").toLowerCase(),
  trim: (val: unknown) => String(val ?? "").trim(),
  json: (val: unknown) => JSON.stringify(val, null, 2),
  truncate: (val: unknown, maxStr?: string) => {
    const max = maxStr ? Number.parseInt(maxStr, 10) : 50;
    const s = String(val ?? "");
    return s.length > max ? s.slice(0, max) + "..." : s;
  },
  indent: (val: unknown, spacesStr?: string) => {
    const spaces = " ".repeat(spacesStr ? Number.parseInt(spacesStr, 10) : 2);
    return String(val ?? "")
      .split("\n")
      .map((line) => `${spaces}${line}`)
      .join("\n");
  },
  codeblock: (val: unknown, lang = "text") => {
    return `\`\`\`${lang}\n${String(val ?? "")}\n\`\`\``;
  },
};

/**
 * Compiles a template string against a data context with conditionals, loops, and filters.
 */
export function composePromptTemplate(
  template: string,
  context: TemplateContext,
  customFilters: Readonly<Record<string, FilterFunction>> = {},
): string {
  const filters = { ...STANDARD_PROMPT_FILTERS, ...customFilters };

  // 1. Process {{#each list}} ... {{/each}}
  let rendered = processEachBlocks(template, context, filters);

  // 2. Process {{#if cond}} ... {{else}} ... {{/if}}
  rendered = processIfBlocks(rendered, context, filters);

  // 3. Process variable interpolation with filters: {{var | filter:arg}}
  rendered = processVariables(rendered, context, filters);

  return rendered;
}

function processEachBlocks(
  text: string,
  context: TemplateContext,
  filters: Readonly<Record<string, FilterFunction>>,
): string {
  const eachRegex = /\{\{#each\s+([a-zA-Z0-9_$.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  return text.replace(eachRegex, (_, varPath, blockContent) => {
    const items = resolveProperty(context, varPath);
    if (!Array.isArray(items) || items.length === 0) {
      return "";
    }

    return items
      .map((item, idx) => {
        const itemCtx =
          typeof item === "object" && item !== null
            ? { ...context, ...item, "@index": idx, this: item }
            : { ...context, "@index": idx, this: item };
        return composePromptTemplate(blockContent, itemCtx, filters);
      })
      .join("");
  });
}

function processIfBlocks(
  text: string,
  context: TemplateContext,
  filters: Readonly<Record<string, FilterFunction>>,
): string {
  const ifRegex =
    /\{\{#if\s+([a-zA-Z0-9_$.]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
  return text.replace(ifRegex, (_, varPath, trueBlock, falseBlock = "") => {
    const val = resolveProperty(context, varPath);
    const isTruthy = Boolean(val && (!Array.isArray(val) || val.length > 0));
    const targetBlock = isTruthy ? trueBlock : falseBlock;
    return composePromptTemplate(targetBlock, context, filters);
  });
}

function processVariables(
  text: string,
  context: TemplateContext,
  filters: Readonly<Record<string, FilterFunction>>,
): string {
  const varRegex = /\{\{([^{}]+)\}\}/g;
  return text.replace(varRegex, (_, expression) => {
    const parts = expression.split("|").map((p: string) => p.trim());
    const varPath = parts[0]!;
    let value = resolveProperty(context, varPath);

    for (let i = 1; i < parts.length; i++) {
      const filterExpr = parts[i]!;
      const [filterName, ...filterArgs] = filterExpr.split(":").map((a: string) => a.trim());
      const fn = filters[filterName!];
      if (fn) {
        value = fn(value, ...filterArgs);
      }
    }

    return value !== undefined && value !== null ? String(value) : "";
  });
}

function resolveProperty(obj: unknown, path: string): unknown {
  if (path === "this") return obj;
  const parts = path.split(".");
  let curr = obj as Record<string, unknown>;

  for (const p of parts) {
    if (curr === undefined || curr === null || typeof curr !== "object") {
      return undefined;
    }
    curr = curr[p] as Record<string, unknown>;
  }

  return curr;
}
