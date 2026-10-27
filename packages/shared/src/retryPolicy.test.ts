import { describe, expect, it } from "vite-plus/test";

import { calculateBackoffDelay, CircuitBreaker, parseRetryAfterHeader } from "./retryPolicy.ts";

describe("calculateBackoffDelay", () => {
  it("computes deterministic delay when jitter is none", () => {
    const delay0 = calculateBackoffDelay(0, { jitterMode: "none", initialDelayMs: 500 });
    const delay1 = calculateBackoffDelay(1, { jitterMode: "none", initialDelayMs: 500 });
    const delay2 = calculateBackoffDelay(2, { jitterMode: "none", initialDelayMs: 500 });

    expect(delay0).toBe(500);
    expect(delay1).toBe(1_000);
    expect(delay2).toBe(2_000);
  });

  it("caps backoff delay at maxDelayMs", () => {
    const capped = calculateBackoffDelay(10, { jitterMode: "none", maxDelayMs: 8_000 });
    expect(capped).toBe(8_000);
  });

  it("applies full jitter uniformly within range", () => {
    const delay = calculateBackoffDelay(
      1,
      { jitterMode: "full", initialDelayMs: 1_000 },
      () => 0.5,
    );
    expect(delay).toBe(1_000); // 2000 * 0.5 = 1000
  });

  it("applies equal jitter within half to full range", () => {
    const delay = calculateBackoffDelay(
      0,
      { jitterMode: "equal", initialDelayMs: 1_000 },
      () => 0.5,
    );
    // base 1000: 500 + 500 * 0.5 = 750
    expect(delay).toBe(750);
  });
});

describe("parseRetryAfterHeader", () => {
  it("parses numeric seconds into milliseconds", () => {
    expect(parseRetryAfterHeader("120")).toBe(120_000);
    expect(parseRetryAfterHeader("  45  ")).toBe(45_000);
  });

  it("parses HTTP date strings relative to now", () => {
    const now = Date.parse("2026-10-28T00:00:00Z");
    const future = "Wed, 28 Oct 2026 00:02:00 GMT";
    expect(parseRetryAfterHeader(future, now)).toBe(120_000);
  });

  it("returns null for invalid or empty inputs", () => {
    expect(parseRetryAfterHeader(null)).toBeNull();
    expect(parseRetryAfterHeader("")).toBeNull();
    expect(parseRetryAfterHeader("not-a-number-or-date")).toBeNull();
  });
});

describe("CircuitBreaker", () => {
  it("starts in closed state and permits executions", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    expect(breaker.getState()).toBe("closed");
    expect(breaker.canExecute()).toBe(true);
  });

  it("trips to open state when failure threshold is reached", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("closed");

    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");
    expect(breaker.canExecute()).toBe(false);
  });

  it("transitions to half-open after recovery timeout expires", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, recoveryTimeoutMs: 10_000 });
    const t0 = 1_000;
    breaker.recordFailure(t0);
    breaker.recordFailure(t0);
    expect(breaker.getState(t0)).toBe("open");

    // After 5s, still open
    expect(breaker.getState(t0 + 5_000)).toBe("open");

    // After 10s, moves to half-open
    expect(breaker.getState(t0 + 10_001)).toBe("half-open");
    expect(breaker.canExecute(t0 + 10_001)).toBe(true);
  });

  it("re-closes circuit after consecutive half-open successes", () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      recoveryTimeoutMs: 5_000,
      halfOpenSuccessThreshold: 2,
    });
    const t0 = 100;
    breaker.recordFailure(t0);
    expect(breaker.getState(t0 + 6_000)).toBe("half-open");

    breaker.recordSuccess();
    expect(breaker.getState(t0 + 6_000)).toBe("half-open");

    breaker.recordSuccess();
    expect(breaker.getState(t0 + 6_000)).toBe("closed");
  });

  it("re-trips to open if a failure occurs in half-open state", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 5_000 });
    const t0 = 100;
    breaker.recordFailure(t0);
    expect(breaker.getState(t0 + 6_000)).toBe("half-open");

    breaker.recordFailure(t0 + 6_100);
    expect(breaker.getState(t0 + 6_100)).toBe("open");
  });
});
