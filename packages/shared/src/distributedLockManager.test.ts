import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DistributedLockManager } from "./distributedLockManager";

describe("DistributedLockManager", () => {
  let manager: DistributedLockManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new DistributedLockManager();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should acquire and release an exclusive lock", async () => {
    expect(manager.isLocked("file_schema.json")).toBe(false);

    const lock = await manager.acquireLock("file_schema.json", "worker-1", { ttlMs: 2000 });
    expect(lock.resource).toBe("file_schema.json");
    expect(lock.owner).toBe("worker-1");
    expect(lock.fencingToken).toBeGreaterThan(1000);
    expect(manager.isLocked("file_schema.json")).toBe(true);

    const released = manager.releaseLock("file_schema.json", "worker-1");
    expect(released).toBe(true);
    expect(manager.isLocked("file_schema.json")).toBe(false);
  });

  it("should support re-entrant locks by the same owner", async () => {
    const lock1 = await manager.acquireLock("db_table", "worker-1", {
      ttlMs: 5000,
      reentrant: true,
    });
    expect(lock1.reentrancyCount).toBe(1);

    const lock2 = await manager.acquireLock("db_table", "worker-1", {
      ttlMs: 5000,
      reentrant: true,
    });
    expect(lock2.reentrancyCount).toBe(2);

    // First release decrements count but keeps locked
    const releasedFirst = manager.releaseLock("db_table", "worker-1");
    expect(releasedFirst).toBe(true);
    expect(manager.isLocked("db_table")).toBe(true);

    // Second release completely frees it
    const releasedSecond = manager.releaseLock("db_table", "worker-1");
    expect(releasedSecond).toBe(true);
    expect(manager.isLocked("db_table")).toBe(false);
  });

  it("should queue contenders and hand off lock upon release", async () => {
    const lock1 = await manager.acquireLock("resource-a", "agent-1", { ttlMs: 5000 });
    expect(lock1.owner).toBe("agent-1");

    let agent2Acquired = false;
    let agent2Token = 0;

    const promise2 = manager.acquireLock("resource-a", "agent-2", { ttlMs: 5000 }).then((lock2) => {
      agent2Acquired = true;
      agent2Token = lock2.fencingToken;
      return lock2;
    });

    expect(agent2Acquired).toBe(false);
    expect(manager.getTelemetry().queuedRequestsCount).toBe(1);

    // Release agent-1's lock
    manager.releaseLock("resource-a", "agent-1");

    // Await second lock acquisition
    await promise2;

    expect(agent2Acquired).toBe(true);
    expect(agent2Token).toBeGreaterThan(lock1.fencingToken);
  });

  it("should timeout when contention exceeds acquireTimeoutMs", async () => {
    await manager.acquireLock("resource-b", "agent-1", { ttlMs: 10000 });

    const promise = manager.acquireLock("resource-b", "agent-2", {
      ttlMs: 5000,
      acquireTimeoutMs: 1500,
    });

    const assertion = expect(promise).rejects.toThrow(
      /Lock acquisition timed out for resource "resource-b"/,
    );

    await vi.advanceTimersByTimeAsync(1505);
    await assertion;
    expect(manager.getTelemetry().totalTimeouts).toBe(1);
  });

  it("should allow multiple concurrent shared read locks", async () => {
    const read1 = await manager.acquireReadLock("config_doc", "reader-1");
    const read2 = await manager.acquireReadLock("config_doc", "reader-2");

    expect(read1.mode).toBe("shared");
    expect(read2.mode).toBe("shared");
    expect(manager.isLocked("config_doc")).toBe(true);

    manager.releaseLock("config_doc", "reader-1");
    expect(manager.isLocked("config_doc")).toBe(true);

    manager.releaseLock("config_doc", "reader-2");
    expect(manager.isLocked("config_doc")).toBe(false);
  });

  it("should automatically evict expired leases", async () => {
    await manager.acquireLock("temp_resource", "agent-x", { ttlMs: 1000 });
    expect(manager.isLocked("temp_resource")).toBe(true);

    // Fast forward past TTL
    await vi.advanceTimersByTimeAsync(1005);

    expect(manager.isLocked("temp_resource")).toBe(false);
    expect(manager.getTelemetry().totalExpiredLeases).toBe(1);
  });

  it("should refresh lock lease via renewLock", async () => {
    await manager.acquireLock("lease_item", "agent-1", { ttlMs: 1000 });

    await vi.advanceTimersByTimeAsync(800);
    const renewed = manager.renewLock("lease_item", "agent-1", 2000);
    expect(renewed).toBe(true);

    // Advance 500ms (total 1300ms from start, would have expired without renew)
    await vi.advanceTimersByTimeAsync(500);
    expect(manager.isLocked("lease_item")).toBe(true);

    // Advance past new expiry
    await vi.advanceTimersByTimeAsync(1600);
    expect(manager.isLocked("lease_item")).toBe(false);
  });

  it("should perform deadlock-free batch acquisition and rollback on failure", async () => {
    // Acquire resource-b exclusively by another agent to cause failure
    await manager.acquireLock("res-b", "other-worker", { ttlMs: 10000 });

    const promise = manager.acquireAllLocks(["res-c", "res-a", "res-b"], "batch-worker", {
      acquireTimeoutMs: 100,
    });

    const assertion = expect(promise).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(150);
    await assertion;

    // Verify all locks for batch-worker were rolled back
    expect(manager.isLocked("res-a")).toBe(false);
    expect(manager.isLocked("res-c")).toBe(false);
  });

  it("should successfully batch acquire and batch release all locks", async () => {
    const locks = await manager.acquireAllLocks(["z_table", "a_table", "m_table"], "batch-agent", {
      ttlMs: 5000,
    });

    expect(locks.length).toBe(3);
    expect(manager.isLocked("z_table")).toBe(true);
    expect(manager.isLocked("a_table")).toBe(true);
    expect(manager.isLocked("m_table")).toBe(true);

    manager.releaseAllLocks(["z_table", "a_table", "m_table"], "batch-agent");
    expect(manager.isLocked("z_table")).toBe(false);
    expect(manager.isLocked("a_table")).toBe(false);
    expect(manager.isLocked("m_table")).toBe(false);
  });
});
