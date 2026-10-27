/**
 * High-Reliability Distributed Lock and Resource Lease Coordinator.
 *
 * Provides exclusive mutexes, shared read-write locks, re-entrant locking,
 * monotonically increasing fencing tokens (for split-brain mitigation),
 * heartbeat lease renewals, and deadlock-free multi-resource batch acquisition.
 *
 * @module distributedLockManager
 */

export interface LockDescriptor {
  readonly resource: string;
  readonly owner: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  readonly fencingToken: number;
  readonly mode: "exclusive" | "shared";
  readonly reentrancyCount: number;
}

export interface LockAcquisitionOptions {
  /** Time-to-live of the lease in milliseconds before auto-expiration (default: 5000) */
  readonly ttlMs?: number;
  /** Max time to wait in queue for contested lock before aborting with timeout (default: 3000) */
  readonly acquireTimeoutMs?: number;
  /** Whether the lock can be re-entered by the same owner (default: true) */
  readonly reentrant?: boolean;
}

export interface LockManagerTelemetry {
  readonly activeLocksCount: number;
  readonly queuedRequestsCount: number;
  readonly totalAcquisitions: number;
  readonly totalContentions: number;
  readonly totalTimeouts: number;
  readonly totalExpiredLeases: number;
}

interface QueuedLockRequest {
  readonly id: string;
  readonly resource: string;
  readonly owner: string;
  readonly mode: "exclusive" | "shared";
  readonly options: Required<LockAcquisitionOptions>;
  readonly resolve: (lock: LockDescriptor) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class DistributedLockManager {
  // active exclusive or shared locks per resource
  private readonly locks = new Map<string, LockDescriptor>();
  // shared reader owners for read-write locking
  private readonly sharedReaders = new Map<string, Map<string, LockDescriptor>>();
  // waiting queues per resource
  private readonly waitQueues = new Map<string, QueuedLockRequest[]>();

  // Global monotonically increasing fencing token
  private globalFencingToken = 1000;

  // Telemetry counters
  private telemetry = {
    totalAcquisitions: 0,
    totalContentions: 0,
    totalTimeouts: 0,
    totalExpiredLeases: 0,
  };

  /**
   * Returns current telemetry snapshot.
   */
  public getTelemetry(): LockManagerTelemetry {
    this.evictExpiredLeases();
    let queued = 0;
    for (const queue of this.waitQueues.values()) {
      queued += queue.length;
    }

    return {
      activeLocksCount: this.locks.size + this.sharedReaders.size,
      queuedRequestsCount: queued,
      totalAcquisitions: this.telemetry.totalAcquisitions,
      totalContentions: this.telemetry.totalContentions,
      totalTimeouts: this.telemetry.totalTimeouts,
      totalExpiredLeases: this.telemetry.totalExpiredLeases,
    };
  }

  /**
   * Acquires an exclusive mutex lock on a resource.
   */
  public async acquireLock(
    resource: string,
    owner: string,
    options: LockAcquisitionOptions = {},
  ): Promise<LockDescriptor> {
    this.evictExpiredLeases();

    const ttlMs = options.ttlMs ?? 5000;
    const acquireTimeoutMs = options.acquireTimeoutMs ?? 3000;
    const reentrant = options.reentrant ?? true;

    const existing = this.locks.get(resource);
    const hasReaders = (this.sharedReaders.get(resource)?.size ?? 0) > 0;

    // Check reentrancy
    if (existing && existing.owner === owner && reentrant && !hasReaders) {
      const updated: LockDescriptor = {
        ...existing,
        reentrancyCount: existing.reentrancyCount + 1,
        expiresAt: Date.now() + ttlMs,
      };
      this.locks.set(resource, updated);
      this.telemetry.totalAcquisitions += 1;
      return updated;
    }

    // If available with no lock and no readers
    if (!existing && !hasReaders) {
      const lock = this.grantLock(resource, owner, "exclusive", ttlMs);
      return lock;
    }

    // Contended - enqueue waiter
    this.telemetry.totalContentions += 1;
    return this.enqueueRequest(resource, owner, "exclusive", {
      ttlMs,
      acquireTimeoutMs,
      reentrant,
    });
  }

  /**
   * Acquires a shared read lock on a resource.
   */
  public async acquireReadLock(
    resource: string,
    owner: string,
    options: LockAcquisitionOptions = {},
  ): Promise<LockDescriptor> {
    this.evictExpiredLeases();

    const ttlMs = options.ttlMs ?? 5000;
    const acquireTimeoutMs = options.acquireTimeoutMs ?? 3000;
    const reentrant = options.reentrant ?? true;

    const exclusiveLock = this.locks.get(resource);

    // If exclusive lock is held by someone else, must wait
    if (exclusiveLock && exclusiveLock.owner !== owner) {
      this.telemetry.totalContentions += 1;
      return this.enqueueRequest(resource, owner, "shared", {
        ttlMs,
        acquireTimeoutMs,
        reentrant,
      });
    }

    // Grant shared reader
    let readers = this.sharedReaders.get(resource);
    if (!readers) {
      readers = new Map();
      this.sharedReaders.set(resource, readers);
    }

    const existingReader = readers.get(owner);
    if (existingReader && reentrant) {
      const updated: LockDescriptor = {
        ...existingReader,
        reentrancyCount: existingReader.reentrancyCount + 1,
        expiresAt: Date.now() + ttlMs,
      };
      readers.set(owner, updated);
      return updated;
    }

    const token = ++this.globalFencingToken;
    const lock: LockDescriptor = {
      resource,
      owner,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      fencingToken: token,
      mode: "shared",
      reentrancyCount: 1,
    };
    readers.set(owner, lock);
    this.telemetry.totalAcquisitions += 1;
    return lock;
  }

  /**
   * Releases an acquired exclusive or shared lock.
   */
  public releaseLock(resource: string, owner: string): boolean {
    this.evictExpiredLeases();

    // Check shared readers first
    const readers = this.sharedReaders.get(resource);
    if (readers && readers.has(owner)) {
      const reader = readers.get(owner)!;
      if (reader.reentrancyCount > 1) {
        readers.set(owner, {
          ...reader,
          reentrancyCount: reader.reentrancyCount - 1,
        });
        return true;
      }
      readers.delete(owner);
      if (readers.size === 0) {
        this.sharedReaders.delete(resource);
      }
      this.processQueue(resource);
      return true;
    }

    // Check exclusive locks
    const existing = this.locks.get(resource);
    if (!existing || existing.owner !== owner) {
      return false;
    }

    if (existing.reentrancyCount > 1) {
      this.locks.set(resource, {
        ...existing,
        reentrancyCount: existing.reentrancyCount - 1,
      });
      return true;
    }

    this.locks.delete(resource);
    this.processQueue(resource);
    return true;
  }

  /**
   * Refreshes the lease TTL of an active lock held by owner.
   */
  public renewLock(resource: string, owner: string, extendMs: number): boolean {
    this.evictExpiredLeases();

    const existing = this.locks.get(resource);
    if (existing && existing.owner === owner) {
      this.locks.set(resource, {
        ...existing,
        expiresAt: Date.now() + extendMs,
      });
      return true;
    }

    const readers = this.sharedReaders.get(resource);
    const reader = readers?.get(owner);
    if (reader) {
      readers!.set(owner, {
        ...reader,
        expiresAt: Date.now() + extendMs,
      });
      return true;
    }

    return false;
  }

  /**
   * Deadlock-free batch acquisition of multiple resources.
   * Sorts resource identifiers lexicographically before acquiring locks in sequence.
   */
  public async acquireAllLocks(
    resources: readonly string[],
    owner: string,
    options: LockAcquisitionOptions = {},
  ): Promise<LockDescriptor[]> {
    const sorted = [...new Set(resources)].sort();
    const acquired: LockDescriptor[] = [];

    try {
      for (const res of sorted) {
        const lock = await this.acquireLock(res, owner, options);
        acquired.push(lock);
      }
      return acquired;
    } catch (err) {
      // Rollback already acquired locks in reverse
      for (const lock of acquired.reverse()) {
        this.releaseLock(lock.resource, owner);
      }
      throw err;
    }
  }

  /**
   * Releases all resources acquired in a batch.
   */
  public releaseAllLocks(resources: readonly string[], owner: string): void {
    for (const res of resources) {
      this.releaseLock(res, owner);
    }
  }

  /**
   * Checks whether a specific resource is currently locked.
   */
  public isLocked(resource: string): boolean {
    this.evictExpiredLeases();
    if (this.locks.has(resource)) return true;
    const readers = this.sharedReaders.get(resource);
    return Boolean(readers && readers.size > 0);
  }

  private grantLock(
    resource: string,
    owner: string,
    mode: "exclusive" | "shared",
    ttlMs: number,
  ): LockDescriptor {
    const token = ++this.globalFencingToken;
    const lock: LockDescriptor = {
      resource,
      owner,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      fencingToken: token,
      mode,
      reentrancyCount: 1,
    };

    if (mode === "exclusive") {
      this.locks.set(resource, lock);
    } else {
      let readers = this.sharedReaders.get(resource);
      if (!readers) {
        readers = new Map();
        this.sharedReaders.set(resource, readers);
      }
      readers.set(owner, lock);
    }

    this.telemetry.totalAcquisitions += 1;
    return lock;
  }

  private enqueueRequest(
    resource: string,
    owner: string,
    mode: "exclusive" | "shared",
    options: Required<LockAcquisitionOptions>,
  ): Promise<LockDescriptor> {
    return new Promise((resolve, reject) => {
      let queue = this.waitQueues.get(resource);
      if (!queue) {
        queue = [];
        this.waitQueues.set(resource, queue);
      }

      const requestId = `req_${Math.random().toString(36).substring(2, 9)}`;

      const timer = setTimeout(() => {
        // Acquisition timed out
        this.removeFromQueue(resource, requestId);
        this.telemetry.totalTimeouts += 1;
        reject(
          new Error(
            `Lock acquisition timed out for resource "${resource}" after ${options.acquireTimeoutMs}ms`,
          ),
        );
      }, options.acquireTimeoutMs);

      queue.push({
        id: requestId,
        resource,
        owner,
        mode,
        options,
        resolve,
        reject,
        timer,
      });
    });
  }

  private removeFromQueue(resource: string, requestId: string): void {
    const queue = this.waitQueues.get(resource);
    if (!queue) return;
    const idx = queue.findIndex((r) => r.id === requestId);
    if (idx !== -1) {
      queue.splice(idx, 1);
      if (queue.length === 0) {
        this.waitQueues.delete(resource);
      }
    }
  }

  private processQueue(resource: string): void {
    const queue = this.waitQueues.get(resource);
    if (!queue || queue.length === 0) return;

    const hasExclusive = this.locks.has(resource);
    const readers = this.sharedReaders.get(resource);
    const hasReaders = Boolean(readers && readers.size > 0);

    if (hasExclusive) return;

    const next = queue[0];
    if (!next) return;

    if (next.mode === "exclusive" && !hasReaders) {
      queue.shift();
      if (queue.length === 0) this.waitQueues.delete(resource);
      clearTimeout(next.timer);
      const lock = this.grantLock(resource, next.owner, "exclusive", next.options.ttlMs);
      next.resolve(lock);
    } else if (next.mode === "shared") {
      // Drain consecutive shared requests
      while (queue.length > 0 && queue[0].mode === "shared") {
        const item = queue.shift()!;
        clearTimeout(item.timer);
        const lock = this.grantLock(resource, item.owner, "shared", item.options.ttlMs);
        item.resolve(lock);
      }
      if (queue.length === 0) this.waitQueues.delete(resource);
    }
  }

  private evictExpiredLeases(): void {
    const now = Date.now();

    // Check exclusive locks
    for (const [res, lock] of this.locks.entries()) {
      if (now >= lock.expiresAt) {
        this.locks.delete(res);
        this.telemetry.totalExpiredLeases += 1;
        this.processQueue(res);
      }
    }

    // Check shared reader locks
    for (const [res, readers] of this.sharedReaders.entries()) {
      for (const [owner, lock] of readers.entries()) {
        if (now >= lock.expiresAt) {
          readers.delete(owner);
          this.telemetry.totalExpiredLeases += 1;
        }
      }
      if (readers.size === 0) {
        this.sharedReaders.delete(res);
        this.processQueue(res);
      }
    }
  }
}
