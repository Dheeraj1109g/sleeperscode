/**
 * Markdown Documentation Parser and Table of Contents Generator.
 *
 * Implements code fence parsing, GitHub alert callouts ([!NOTE], [!WARNING], etc.),
 * table parsing with alignment markers, and automated Table of Contents (TOC) extraction.
 *
 * @module markdownDocumentationEngine
 */

export interface MarkdownHeader {
  readonly level: number;
  readonly text: string;
  readonly slug: string;
  readonly lineNumber: number;
}

export interface MarkdownCodeBlock {
  readonly language: string;
  readonly content: string;
  readonly startLine: number;
  readonly endLine: number;
}

export type CalloutType = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

export interface MarkdownCallout {
  readonly type: CalloutType;
  readonly content: string;
  readonly lineNumber: number;
}

export interface MarkdownTable {
  readonly headers: readonly string[];
  readonly alignments: readonly ("left" | "center" | "right")[];
  readonly rows: readonly (readonly string[])[];
  readonly lineNumber: number;
}

export interface ParsedMarkdownDocument {
  readonly headers: readonly MarkdownHeader[];
  readonly codeBlocks: readonly MarkdownCodeBlock[];
  readonly callouts: readonly MarkdownCallout[];
  readonly tables: readonly MarkdownTable[];
  readonly tableOfContentsMarkdown: string;
}

/**
 * Creates a GitHub-compatible markdown heading slug from title text.
 */
export function slugifyHeader(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

/**
 * Parses full markdown text into structured document components.
 */
export function parseMarkdownDocument(markdown: string): ParsedMarkdownDocument {
  const lines = markdown.split(/\r?\n/);
  const headers: MarkdownHeader[] = [];
  const codeBlocks: MarkdownCodeBlock[] = [];
  const callouts: MarkdownCallout[] = [];
  const tables: MarkdownTable[] = [];

  let inCodeBlock = false;
  let codeBlockLanguage = "";
  let codeBlockContent: string[] = [];
  let codeBlockStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const lineNum = i + 1;

    // Code block toggle
    if (rawLine.trim().startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLanguage = rawLine.trim().slice(3).trim();
        codeBlockContent = [];
        codeBlockStartLine = lineNum;
      } else {
        inCodeBlock = false;
        codeBlocks.push({
          language: codeBlockLanguage,
          content: codeBlockContent.join("\n"),
          startLine: codeBlockStartLine,
          endLine: lineNum,
        });
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(rawLine);
      continue;
    }

    // Header matching (# ... ######)
    const headerMatch = /^(#{1,6})\s+(.+)$/.exec(rawLine.trim());
    if (headerMatch) {
      const level = headerMatch[1]!.length;
      const text = headerMatch[2]!.trim();
      headers.push({
        level,
        text,
        slug: slugifyHeader(text),
        lineNumber: lineNum,
      });
      continue;
    }

    // Callout matching (> [!NOTE])
    const calloutMatch = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(
      rawLine.trim(),
    );
    if (calloutMatch) {
      const type = calloutMatch[1]!.toUpperCase() as CalloutType;
      const content = calloutMatch[2]!.trim();
      callouts.push({
        type,
        content,
        lineNumber: lineNum,
      });
      continue;
    }

    // Table detection: line with pipes (| a | b |) followed by delimiter line (|---|---|)
    if (rawLine.includes("|") && i + 1 < lines.length) {
      const nextLine = lines[i + 1]!.trim();
      if (/^\|?\s*[-:]+[-| :]*\s*\|?$/.test(nextLine) && nextLine.includes("-")) {
        const headerRow = parseTableRow(rawLine);
        const delimiterRow = parseTableRow(nextLine);
        const alignments = delimiterRow.map(parseAlignment);
        const rows: string[][] = [];

        let rowIdx = i + 2;
        while (rowIdx < lines.length && lines[rowIdx]!.trim().includes("|")) {
          const rowData = parseTableRow(lines[rowIdx]!);
          if (rowData.length > 0) {
            rows.push(rowData);
          }
          rowIdx++;
        }

        tables.push({
          headers: headerRow,
          alignments,
          rows,
          lineNumber: lineNum,
        });

        i = rowIdx - 1; // advance loop past parsed table
      }
    }
  }

  // Generate Table of Contents
  const tocMarkdown = generateTableOfContents(headers);

  return {
    headers,
    codeBlocks,
    callouts,
    tables,
    tableOfContentsMarkdown: tocMarkdown,
  };
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const withoutOuterPipes = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return withoutOuterPipes.split("|").map((cell) => cell.trim());
}

function parseAlignment(cell: string): "left" | "center" | "right" {
  const trimmed = cell.trim();
  const startsWithColon = trimmed.startsWith(":");
  const endsWithColon = trimmed.endsWith(":");

  if (startsWithColon && endsWithColon) return "center";
  if (endsWithColon) return "right";
  return "left";
}

/**
 * Generates an indented markdown Table of Contents from an array of headers.
 */
export function generateTableOfContents(headers: readonly MarkdownHeader[]): string {
  if (headers.length === 0) return "";

  const minLevel = Math.min(...headers.map((h) => h.level));
  const lines: string[] = [];

  for (const h of headers) {
    const indent = "  ".repeat(Math.max(0, h.level - minLevel));
    lines.push(`${indent}- [${h.text}](#${h.slug})`);
  }

  return lines.join("\n");
}
