import { describe, expect, it } from "vite-plus/test";

import { calculateDiffStats, parseUnifiedDiff } from "./diffParser.ts";

const SAMPLE_DIFF = `diff --git a/src/math.ts b/src/math.ts
index 1234..5678 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,4 +1,5 @@
 export function add(a: number, b: number): number {
-  return a - b;
+  // Fixed addition bug
+  return a + b;
 }
diff --git a/docs/README.md b/docs/README.md
new file mode 100644
index 0000..9999
--- /dev/null
+++ b/docs/README.md
@@ -0,0 +1,2 @@
+# Documentation
+Welcome to Sleepers Code.
`;

describe("parseUnifiedDiff", () => {
  it("parses multiple files with additions and deletions", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    expect(files).toHaveLength(2);

    const first = files[0]!;
    expect(first.oldPath).toBe("src/math.ts");
    expect(first.newPath).toBe("src/math.ts");
    expect(first.isNewFile).toBe(false);
    expect(first.hunks).toHaveLength(1);
    expect(first.additions).toBe(2);
    expect(first.deletions).toBe(1);

    const second = files[1]!;
    expect(second.newPath).toBe("docs/README.md");
    expect(second.isNewFile).toBe(true);
    expect(second.additions).toBe(2);
    expect(second.deletions).toBe(0);
  });

  it("assigns accurate line numbers to hunks", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const hunk = files[0]!.hunks[0]!;

    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);

    const addLines = hunk.lines.filter((l) => l.type === "add");
    expect(addLines[0]?.newLineNumber).toBe(2);
    expect(addLines[1]?.newLineNumber).toBe(3);

    const delLines = hunk.lines.filter((l) => l.type === "delete");
    expect(delLines[0]?.oldLineNumber).toBe(2);
  });

  it("handles empty diffs safely", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("   \n  ")).toEqual([]);
  });
});

describe("calculateDiffStats", () => {
  it("calculates total additions, deletions, and churn ratio correctly", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const stats = calculateDiffStats(files);

    expect(stats.totalFilesChanged).toBe(2);
    expect(stats.totalAdditions).toBe(4); // 2 + 2
    expect(stats.totalDeletions).toBe(1); // 1 + 0
    expect(stats.netLineDelta).toBe(3); // 4 - 1
    expect(stats.churnRatio).toBe(0.2); // 1 / 5 = 0.2
  });

  it("returns zero stats for empty file arrays", () => {
    const stats = calculateDiffStats([]);
    expect(stats.totalFilesChanged).toBe(0);
    expect(stats.totalAdditions).toBe(0);
    expect(stats.churnRatio).toBe(0);
  });
});
