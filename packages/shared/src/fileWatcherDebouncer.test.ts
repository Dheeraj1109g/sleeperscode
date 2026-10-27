import { describe, expect, it } from "vite-plus/test";

import { coalesceFileEvents, FileWatcherDebouncer, isPathIgnored } from "./fileWatcherDebouncer.ts";

describe("isPathIgnored", () => {
  it("ignores standard version control and build folders", () => {
    expect(isPathIgnored(".git/HEAD")).toBe(true);
    expect(isPathIgnored("C:\\Users\\test\\.git\\index")).toBe(true);
    expect(isPathIgnored("node_modules/vite/package.json")).toBe(true);
    expect(isPathIgnored("dist/bundle.js")).toBe(true);
    expect(isPathIgnored("file.tmp")).toBe(true);
  });

  it("permits regular source files", () => {
    expect(isPathIgnored("src/components/App.tsx")).toBe(false);
    expect(isPathIgnored("packages/shared/src/String.ts")).toBe(false);
  });
});

describe("coalesceFileEvents", () => {
  it("coalesces create followed by modify into create", () => {
    const events = [
      { path: "src/newFile.ts", kind: "create" as const, timestamp: 100 },
      { path: "src/newFile.ts", kind: "modify" as const, timestamp: 200 },
    ];
    const coalesced = coalesceFileEvents(events);
    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]?.kind).toBe("create");
    expect(coalesced[0]?.eventCount).toBe(2);
  });

  it("eliminates transient files created then deleted in the same window", () => {
    const events = [
      { path: "temp.swap", kind: "create" as const, timestamp: 100 },
      { path: "temp.swap", kind: "delete" as const, timestamp: 200 },
    ];
    const coalesced = coalesceFileEvents(events);
    expect(coalesced).toHaveLength(0);
  });

  it("preserves distinct files sorted by path", () => {
    const events = [
      { path: "z.ts", kind: "modify" as const, timestamp: 100 },
      { path: "a.ts", kind: "create" as const, timestamp: 200 },
    ];
    const coalesced = coalesceFileEvents(events);
    expect(coalesced[0]?.path).toBe("a.ts");
    expect(coalesced[1]?.path).toBe("z.ts");
  });
});

describe("FileWatcherDebouncer", () => {
  it("collects non-ignored events and flushes coalesced changes", () => {
    const debouncer = new FileWatcherDebouncer({ debounceMs: 100 });
    debouncer.push({ path: "src/file1.ts", kind: "create", timestamp: 1000 });
    debouncer.push({ path: "node_modules/pkg/index.js", kind: "modify", timestamp: 1050 }); // ignored
    debouncer.push({ path: "src/file1.ts", kind: "modify", timestamp: 1080 });

    expect(debouncer.pendingCount()).toBe(2); // node_modules was dropped

    // Before debounce threshold
    expect(debouncer.shouldFlush(1120)).toBe(false);

    // After debounce quiet period (1080 + 100 = 1180)
    expect(debouncer.shouldFlush(1200)).toBe(true);

    const changes = debouncer.flush();
    expect(changes).toHaveLength(1);
    expect(changes[0]?.path).toBe("src/file1.ts");
    expect(changes[0]?.kind).toBe("create");
    expect(changes[0]?.eventCount).toBe(2);
    expect(debouncer.pendingCount()).toBe(0);
  });
});
