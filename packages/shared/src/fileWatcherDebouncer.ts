/**
 * File System Event Coalescing and Debounce Pipeline.
 *
 * Merges high-frequency filesystem events (create, modify, delete) into consolidated
 * checkpoint batches while ignoring noise patterns (.git, node_modules, temp files).
 *
 * @module fileWatcherDebouncer
 */

export type FileChangeKind = "create" | "modify" | "delete";

export interface RawFileEvent {
  readonly path: string;
  readonly kind: FileChangeKind;
  readonly timestamp: number;
}

export interface CoalescedFileChange {
  readonly path: string;
  readonly kind: FileChangeKind;
  readonly eventCount: number;
  readonly firstTimestamp: number;
  readonly lastTimestamp: number;
}

export interface DebouncerOptions {
  readonly debounceMs?: number;
  readonly maxWaitMs?: number;
  readonly ignoredPatterns?: readonly (string | RegExp)[];
}

const DEFAULT_IGNORED_PATTERNS: readonly RegExp[] = [
  /(?:^|[\\/])\.git(?:[\\/]|$)/,
  /(?:^|[\\/])node_modules(?:[\\/]|$)/,
  /(?:^|[\\/])dist(?:[\\/]|$)/,
  /(?:^|[\\/])\.cache(?:[\\/]|$)/,
  /(?:^|[\\/])\.t3(?:[\\/]|$)/,
  /~$/,
  /\.tmp$/,
  /\.swp$/,
];

/**
 * Checks whether a given file path matches standard or custom ignored patterns.
 */
export function isPathIgnored(
  filePath: string,
  customPatterns: readonly (string | RegExp)[] = [],
): boolean {
  const allPatterns = [...DEFAULT_IGNORED_PATTERNS, ...customPatterns];
  const normalized = filePath.replace(/\\/g, "/");

  for (const pattern of allPatterns) {
    if (pattern instanceof RegExp) {
      if (pattern.test(normalized) || pattern.test(filePath)) return true;
    } else if (typeof pattern === "string") {
      if (normalized.includes(pattern) || filePath.includes(pattern)) return true;
    }
  }

  return false;
}

/**
 * Coalesces an array of raw file events into a minimal set of net changes.
 * E.g., create followed by modify -> create; create followed by delete -> null.
 */
export function coalesceFileEvents(
  events: readonly RawFileEvent[],
): readonly CoalescedFileChange[] {
  const map = new Map<
    string,
    {
      kind: FileChangeKind;
      eventCount: number;
      firstTimestamp: number;
      lastTimestamp: number;
    }
  >();

  for (const ev of events) {
    const existing = map.get(ev.path);
    if (!existing) {
      map.set(ev.path, {
        kind: ev.kind,
        eventCount: 1,
        firstTimestamp: ev.timestamp,
        lastTimestamp: ev.timestamp,
      });
    } else {
      let nextKind = existing.kind;

      // Net state machine transition
      if (existing.kind === "create" && ev.kind === "modify") {
        nextKind = "create"; // created file was just edited
      } else if (existing.kind === "create" && ev.kind === "delete") {
        // Transient file created then deleted -> remove completely
        map.delete(ev.path);
        continue;
      } else if (existing.kind === "modify" && ev.kind === "delete") {
        nextKind = "delete";
      } else if (existing.kind === "delete" && ev.kind === "create") {
        nextKind = "modify";
      } else {
        nextKind = ev.kind;
      }

      map.set(ev.path, {
        kind: nextKind,
        eventCount: existing.eventCount + 1,
        firstTimestamp: existing.firstTimestamp,
        lastTimestamp: ev.timestamp,
      });
    }
  }

  const results: CoalescedFileChange[] = [];
  for (const [path, data] of map.entries()) {
    results.push({
      path,
      kind: data.kind,
      eventCount: data.eventCount,
      firstTimestamp: data.firstTimestamp,
      lastTimestamp: data.lastTimestamp,
    });
  }

  return results.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Debouncer engine collecting file events and flushing batches once activity settles.
 */
export class FileWatcherDebouncer {
  private events: RawFileEvent[] = [];
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly ignoredPatterns: readonly (string | RegExp)[];
  private firstEventTime = 0;
  private lastEventTime = 0;

  constructor(options: DebouncerOptions = {}) {
    this.debounceMs = options.debounceMs ?? 300;
    this.maxWaitMs = options.maxWaitMs ?? 2_000;
    this.ignoredPatterns = options.ignoredPatterns ?? [];
  }

  public push(event: RawFileEvent): boolean {
    if (isPathIgnored(event.path, this.ignoredPatterns)) {
      return false;
    }

    const now = event.timestamp || Date.now();
    if (this.events.length === 0) {
      this.firstEventTime = now;
    }
    this.lastEventTime = now;
    this.events.push({ ...event, timestamp: now });
    return true;
  }

  public shouldFlush(now = Date.now()): boolean {
    if (this.events.length === 0) return false;
    const quietTime = now - this.lastEventTime;
    const totalTime = now - this.firstEventTime;
    return quietTime >= this.debounceMs || totalTime >= this.maxWaitMs;
  }

  public flush(): readonly CoalescedFileChange[] {
    const batched = coalesceFileEvents(this.events);
    this.events = [];
    this.firstEventTime = 0;
    this.lastEventTime = 0;
    return batched;
  }

  public pendingCount(): number {
    return this.events.length;
  }
}
