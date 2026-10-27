/**
 * Lightweight Code AST Tokenizer, Symbol Extractor, and Complexity Analyzer.
 *
 * Analyzes code structure, extracts functions, classes, imports, and exports,
 * computes cyclomatic complexity heuristics, and counts SLOC/comment lines.
 *
 * @module codeASTTokenParser
 */

export type SourceLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "json"
  | "unknown";

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "import"
  | "export"
  | "variable";

export interface CodeSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly lineNumber: number;
  readonly isExported?: boolean;
}

export interface CodeMetrics {
  readonly totalLines: number;
  readonly sourceLinesOfCode: number;
  readonly commentLines: number;
  readonly blankLines: number;
  readonly cyclomaticComplexity: number;
  readonly symbols: readonly CodeSymbol[];
}

/**
 * Detects programming language from file path extension.
 */
export function detectLanguage(filePath: string): SourceLanguage {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs"))
    return "javascript";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".json")) return "json";
  return "unknown";
}

/**
 * Computes source metrics, comment vs code ratios, and symbol inventory.
 */
export function analyzeSourceCode(code: string, language?: SourceLanguage): CodeMetrics {
  const lines = code.split(/\r?\n/);
  const totalLines = lines.length;
  let sourceLinesOfCode = 0;
  let commentLines = 0;
  let blankLines = 0;
  let cyclomaticComplexity = 1; // Base complexity is 1

  let inBlockComment = false;
  const symbols: CodeSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();
    const lineNum = i + 1;

    if (line.length === 0) {
      blankLines++;
      continue;
    }

    // Block comment handling (C-style)
    if (inBlockComment) {
      commentLines++;
      if (line.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    if (line.startsWith("/*")) {
      commentLines++;
      if (!line.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }

    // Single line comments
    if (line.startsWith("//") || line.startsWith("#")) {
      commentLines++;
      continue;
    }

    sourceLinesOfCode++;

    // Cyclomatic complexity branching indicators
    const branchMatches = line.match(/\b(if|else\s+if|for|while|switch|case|catch)\b|\?|&&|\|\|/g);
    if (branchMatches) {
      cyclomaticComplexity += branchMatches.length;
    }

    // Symbol extraction heuristics
    extractSymbolsFromLine(line, lineNum, symbols, language ?? "typescript");
  }

  return {
    totalLines,
    sourceLinesOfCode,
    commentLines,
    blankLines,
    cyclomaticComplexity,
    symbols,
  };
}

function extractSymbolsFromLine(
  line: string,
  lineNumber: number,
  symbols: CodeSymbol[],
  lang: SourceLanguage,
): void {
  const isExported = line.startsWith("export ");

  if (lang === "typescript" || lang === "javascript") {
    // Function declaration: (export )?(async )?function name(...)
    const fnMatch = /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/.exec(line);
    if (fnMatch && fnMatch[1]) {
      symbols.push({ name: fnMatch[1], kind: "function", lineNumber, isExported });
      return;
    }

    // Arrow function variable: (export )?(const|let) name = (async )?(...) =>
    const arrowMatch =
      /(?:export\s+)?(?:const|let)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/.exec(
        line,
      );
    if (arrowMatch && arrowMatch[1]) {
      symbols.push({ name: arrowMatch[1], kind: "function", lineNumber, isExported });
      return;
    }

    // Class declaration
    const classMatch = /(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+)/.exec(line);
    if (classMatch && classMatch[1]) {
      symbols.push({ name: classMatch[1], kind: "class", lineNumber, isExported });
      return;
    }

    // Interface declaration
    const ifaceMatch = /(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)/.exec(line);
    if (ifaceMatch && ifaceMatch[1]) {
      symbols.push({ name: ifaceMatch[1], kind: "interface", lineNumber, isExported });
      return;
    }

    // Type alias
    const typeMatch = /(?:export\s+)?type\s+([a-zA-Z0-9_$]+)\s*=/.exec(line);
    if (typeMatch && typeMatch[1]) {
      symbols.push({ name: typeMatch[1], kind: "type", lineNumber, isExported });
      return;
    }

    // Imports
    const importMatch =
      /^import\s+(?:\{[^}]+\}|[a-zA-Z0-9_$*]+|\*\s+as\s+[a-zA-Z0-9_$]+)\s+from\s+["']([^"']+)["']/.exec(
        line,
      );
    if (importMatch && importMatch[1]) {
      symbols.push({ name: importMatch[1], kind: "import", lineNumber });
      return;
    }
  } else if (lang === "python") {
    // Python def
    const pyFnMatch = /^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(/.exec(line);
    if (pyFnMatch && pyFnMatch[1]) {
      symbols.push({ name: pyFnMatch[1], kind: "function", lineNumber });
      return;
    }
    // Python class
    const pyClassMatch = /^class\s+([a-zA-Z0-9_]+)/.exec(line);
    if (pyClassMatch && pyClassMatch[1]) {
      symbols.push({ name: pyClassMatch[1], kind: "class", lineNumber });
      return;
    }
  } else if (lang === "rust") {
    // Rust fn
    const rsFnMatch = /(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/.exec(line);
    if (rsFnMatch && rsFnMatch[1]) {
      symbols.push({
        name: rsFnMatch[1],
        kind: "function",
        lineNumber,
        isExported: line.startsWith("pub "),
      });
      return;
    }
    // Rust struct
    const rsStructMatch = /(?:pub\s+)?struct\s+([a-zA-Z0-9_]+)/.exec(line);
    if (rsStructMatch && rsStructMatch[1]) {
      symbols.push({
        name: rsStructMatch[1],
        kind: "class",
        lineNumber,
        isExported: line.startsWith("pub "),
      });
      return;
    }
  }
}
