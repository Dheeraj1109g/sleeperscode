/**
 * Unified Diff Parser and Patch Analysis Utility.
 *
 * Parses raw git unified diffs into structured file ASTs, computes churn statistics
 * (additions, deletions, net delta, churn ratio), and inspects hunk headers.
 *
 * @module diffParser
 */

export interface DiffLine {
  readonly type: "add" | "delete" | "context";
  readonly content: string;
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
}

export interface DiffHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

export interface FileDiff {
  readonly oldPath: string;
  readonly newPath: string;
  readonly isNewFile: boolean;
  readonly isDeletedFile: boolean;
  readonly isBinary: boolean;
  readonly hunks: readonly DiffHunk[];
  readonly additions: number;
  readonly deletions: number;
}

export interface DiffSummaryStats {
  readonly totalFilesChanged: number;
  readonly totalAdditions: number;
  readonly totalDeletions: number;
  readonly netLineDelta: number;
  readonly churnRatio: number;
}

/**
 * Parses raw unified diff string into an array of structured FileDiff records.
 */
export function parseUnifiedDiff(rawDiff: string): readonly FileDiff[] {
  if (!rawDiff || !rawDiff.trim()) return [];

  const files: FileDiff[] = [];
  const lines = rawDiff.split(/\r?\n/);

  let currentOldPath = "";
  let currentNewPath = "";
  let isNewFile = false;
  let isDeletedFile = false;
  let isBinary = false;
  let currentHunks: DiffHunk[] = [];
  let currentHunkLines: DiffLine[] = [];
  let currentHunkHeader = "";
  let oldStart = 0;
  let oldLines = 0;
  let newStart = 0;
  let newLines = 0;
  let oldLineCounter = 0;
  let newLineCounter = 0;

  const flushHunk = () => {
    if (currentHunkHeader && currentHunkLines.length > 0) {
      currentHunks.push({
        header: currentHunkHeader,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [...currentHunkLines],
      });
      currentHunkLines = [];
      currentHunkHeader = "";
    }
  };

  const flushFile = () => {
    flushHunk();
    if (currentOldPath || currentNewPath) {
      const additions = currentHunks.reduce(
        (sum, h) => sum + h.lines.filter((l) => l.type === "add").length,
        0,
      );
      const deletions = currentHunks.reduce(
        (sum, h) => sum + h.lines.filter((l) => l.type === "delete").length,
        0,
      );

      files.push({
        oldPath: currentOldPath,
        newPath: currentNewPath,
        isNewFile,
        isDeletedFile,
        isBinary,
        hunks: [...currentHunks],
        additions,
        deletions,
      });

      currentOldPath = "";
      currentNewPath = "";
      isNewFile = false;
      isDeletedFile = false;
      isBinary = false;
      currentHunks = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith("diff --git ")) {
      flushFile();
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (match) {
        currentOldPath = match[1] ?? "";
        currentNewPath = match[2] ?? "";
      }
    } else if (line.startsWith("new file mode ")) {
      isNewFile = true;
    } else if (line.startsWith("deleted file mode ")) {
      isDeletedFile = true;
    } else if (line.startsWith("Binary files ") || line.includes("GIT binary patch")) {
      isBinary = true;
    } else if (line.startsWith("--- ")) {
      const match = /^--- (?:a\/)?(.*)$/.exec(line);
      if (match && match[1] && match[1] !== "/dev/null") {
        currentOldPath = match[1];
      }
    } else if (line.startsWith("+++ ")) {
      const match = /^\+\+\+ (?:b\/)?(.*)$/.exec(line);
      if (match && match[1] && match[1] !== "/dev/null") {
        currentNewPath = match[1];
      }
    } else if (line.startsWith("@@ ")) {
      flushHunk();
      const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
      if (hunkMatch) {
        oldStart = Number.parseInt(hunkMatch[1] ?? "1", 10);
        oldLines = Number.parseInt(hunkMatch[2] ?? "1", 10);
        newStart = Number.parseInt(hunkMatch[3] ?? "1", 10);
        newLines = Number.parseInt(hunkMatch[4] ?? "1", 10);
        currentHunkHeader = line;
        oldLineCounter = oldStart;
        newLineCounter = newStart;
      }
    } else if (currentHunkHeader) {
      if (line.startsWith("+")) {
        currentHunkLines.push({
          type: "add",
          content: line.slice(1),
          newLineNumber: newLineCounter++,
        });
      } else if (line.startsWith("-")) {
        currentHunkLines.push({
          type: "delete",
          content: line.slice(1),
          oldLineNumber: oldLineCounter++,
        });
      } else if (line.startsWith(" ")) {
        currentHunkLines.push({
          type: "context",
          content: line.slice(1),
          oldLineNumber: oldLineCounter++,
          newLineNumber: newLineCounter++,
        });
      }
    }
  }

  flushFile();
  return files;
}

/**
 * Calculates total additions, deletions, and churn ratio across all changed files.
 */
export function calculateDiffStats(files: readonly FileDiff[]): DiffSummaryStats {
  const totalFilesChanged = files.length;
  const totalAdditions = files.reduce((acc, f) => acc + f.additions, 0);
  const totalDeletions = files.reduce((acc, f) => acc + f.deletions, 0);
  const netLineDelta = totalAdditions - totalDeletions;
  const totalModifications = totalAdditions + totalDeletions;
  const churnRatio =
    totalModifications > 0 ? Number((totalDeletions / totalModifications).toFixed(4)) : 0;

  return {
    totalFilesChanged,
    totalAdditions,
    totalDeletions,
    netLineDelta,
    churnRatio,
  };
}
