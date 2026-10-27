import { describe, expect, it } from "vite-plus/test";

import {
  generateTableOfContents,
  parseMarkdownDocument,
  slugifyHeader,
} from "./markdownDocumentationEngine.ts";

describe("slugifyHeader", () => {
  it("converts titles into anchor slugs", () => {
    expect(slugifyHeader("Getting Started & Installation")).toBe("getting-started-installation");
    expect(slugifyHeader("Feature 1: Task Scheduling")).toBe("feature-1-task-scheduling");
  });
});

describe("parseMarkdownDocument", () => {
  it("extracts headers, code fences, callouts, and tables accurately", () => {
    const markdown = `
# Project Documentation

Welcome to Sleepers Code.

> [!NOTE]
> This is an important note regarding setup.

## Installation Guide

\`\`\`bash
git clone https://github.com/yuno7777/sleeperscode.git
cd sleeperscode
\`\`\`

### Comparison Table

| Tool | Mode | Speed |
| :--- | :---: | ---: |
| Fast | Auto | High |
| Safe | Manual | Med |
`;

    const doc = parseMarkdownDocument(markdown);

    // Headers
    expect(doc.headers).toHaveLength(3);
    expect(doc.headers[0]?.text).toBe("Project Documentation");
    expect(doc.headers[1]?.text).toBe("Installation Guide");
    expect(doc.headers[2]?.text).toBe("Comparison Table");

    // Callout
    expect(doc.callouts).toHaveLength(1);
    expect(doc.callouts[0]?.type).toBe("NOTE");

    // Code block
    expect(doc.codeBlocks).toHaveLength(1);
    expect(doc.codeBlocks[0]?.language).toBe("bash");
    expect(doc.codeBlocks[0]?.content).toContain("git clone");

    // Table
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0]?.headers).toEqual(["Tool", "Mode", "Speed"]);
    expect(doc.tables[0]?.alignments).toEqual(["left", "center", "right"]);
    expect(doc.tables[0]?.rows).toHaveLength(2);

    // Table of contents
    expect(doc.tableOfContentsMarkdown).toContain(
      "- [Project Documentation](#project-documentation)",
    );
    expect(doc.tableOfContentsMarkdown).toContain("  - [Installation Guide](#installation-guide)");
  });
});

describe("generateTableOfContents", () => {
  it("generates correctly indented lists", () => {
    const headers = [
      { level: 1, text: "Overview", slug: "overview", lineNumber: 1 },
      { level: 2, text: "Architecture", slug: "architecture", lineNumber: 10 },
      { level: 3, text: "Runtime Sidecar", slug: "runtime-sidecar", lineNumber: 20 },
    ];

    const toc = generateTableOfContents(headers);
    expect(toc).toBe(
      "- [Overview](#overview)\n  - [Architecture](#architecture)\n    - [Runtime Sidecar](#runtime-sidecar)",
    );
  });
});
