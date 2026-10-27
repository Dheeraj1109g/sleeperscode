import { describe, expect, it } from "vite-plus/test";

import { SlidingWindowRateLimiter, TokenBucketRateLimiter } from "./agentRateLimiterTokenBucket.ts";

describe("TokenBucketRateLimiter", () => {
  it("permits burst consumption within capacity", () => {
    const bucket = new TokenBucketRateLimiter({ capacity: 10, refillRatePerSecond: 2 }, 10, 1000);
    expect(bucket.tryConsume(5, 1000)).toBe(true);
    expect(bucket.tryConsume(5, 1000)).toBe(true);
    // Depleted
    expect(bucket.tryConsume(1, 1000)).toBe(false);
  });

  it("refills tokens over time at configured rate", () => {
    const bucket = new TokenBucketRateLimiter({ capacity: 10, refillRatePerSecond: 5 }, 0, 1000);
    // After 1 second, 5 tokens added
    expect(bucket.tryConsume(4, 2000)).toBe(true);
  });

  it("calculates accurate wait time when throttled", () => {
    const bucket = new TokenBucketRateLimiter({ capacity: 10, refillRatePerSecond: 2 }, 0, 1000);
    const status = bucket.check(4, 1000);
    expect(status.isAllowed).toBe(false);
    // Needs 4 tokens @ 2 tokens/sec = 2,000ms
    expect(status.waitTimeMs).toBe(2000);
  });

  it("enforces maximum concurrency limits", () => {
    const bucket = new TokenBucketRateLimiter(
      { capacity: 100, refillRatePerSecond: 10, maxConcurrency: 2 },
      100,
    );
    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(true);
    // Concurrency limit reached
    expect(bucket.tryConsume(1)).toBe(false);

    // Release slot
    bucket.releaseConcurrency();
    expect(bucket.tryConsume(1)).toBe(true);
  });
});

describe("SlidingWindowRateLimiter", () => {
  it("allows up to max requests in rolling window", () => {
    const limiter = new SlidingWindowRateLimiter(3, 1000);
    const t0 = 1000;
    expect(limiter.tryAcquire(t0)).toBe(true);
    expect(limiter.tryAcquire(t0 + 100)).toBe(true);
    expect(limiter.tryAcquire(t0 + 200)).toBe(true);
    // Limit reached
    expect(limiter.tryAcquire(t0 + 300)).toBe(false);

    // After window expires (1000 + 1001 = 2001)
    expect(limiter.tryAcquire(t0 + 1050)).toBe(true);
  });

  it("reports accurate remaining capacity", () => {
    const limiter = new SlidingWindowRateLimiter(5, 60_000);
    expect(limiter.getRemainingRequests()).toBe(5);
    limiter.tryAcquire();
    expect(limiter.getRemainingRequests()).toBe(4);
  });
});
