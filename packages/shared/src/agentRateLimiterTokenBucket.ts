/**
 * Token Bucket and Sliding-Window Rate Limiter Engine.
 *
 * Implements token bucket rate limiting for LLM tokens-per-minute (TPM) and requests-per-minute (RPM),
 * with burst allowance, concurrency slot tracking, and wait-time estimation.
 *
 * @module agentRateLimiterTokenBucket
 */

export interface RateLimiterConfig {
  /** Maximum burst tokens capacity in the bucket. */
  readonly capacity: number;
  /** Tokens added to the bucket per second. */
  readonly refillRatePerSecond: number;
  /** Maximum concurrent in-flight requests permitted. */
  readonly maxConcurrency?: number;
}

export interface RateLimitStatus {
  readonly isAllowed: boolean;
  readonly availableTokens: number;
  readonly capacity: number;
  readonly waitTimeMs: number;
  readonly activeConcurrency: number;
  readonly maxConcurrency: number;
}

/**
 * Token Bucket Rate Limiter with sub-millisecond replenishment precision.
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillTimestamp: number;
  private activeConcurrency = 0;
  private readonly capacity: number;
  private readonly refillRatePerSecond: number;
  private readonly maxConcurrency: number;

  constructor(config: RateLimiterConfig, initialTokens?: number, now = Date.now()) {
    this.capacity = Math.max(1, config.capacity);
    this.refillRatePerSecond = Math.max(0.0001, config.refillRatePerSecond);
    this.maxConcurrency = config.maxConcurrency ?? Number.POSITIVE_INFINITY;
    this.tokens =
      initialTokens !== undefined
        ? Math.min(this.capacity, Math.max(0, initialTokens))
        : this.capacity;
    this.lastRefillTimestamp = now;
  }

  /**
   * Refills the bucket based on elapsed time since the last replenishment.
   */
  public refill(now = Date.now()): void {
    if (now <= this.lastRefillTimestamp) return;

    const elapsedSeconds = (now - this.lastRefillTimestamp) / 1_000;
    const tokensToAdd = elapsedSeconds * this.refillRatePerSecond;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefillTimestamp = now;
  }

  /**
   * Attempts to consume a specified number of tokens from the bucket.
   */
  public tryConsume(tokens = 1, now = Date.now()): boolean {
    this.refill(now);

    if (this.activeConcurrency >= this.maxConcurrency) {
      return false;
    }

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      this.activeConcurrency += 1;
      return true;
    }

    return false;
  }

  /**
   * Releases an active concurrency slot upon request completion.
   */
  public releaseConcurrency(): void {
    this.activeConcurrency = Math.max(0, this.activeConcurrency - 1);
  }

  /**
   * Checks whether tokens can be consumed and calculates estimated wait time if throttled.
   */
  public check(tokens = 1, now = Date.now()): RateLimitStatus {
    this.refill(now);

    const isConcurrencyBlocked = this.activeConcurrency >= this.maxConcurrency;
    const hasEnoughTokens = this.tokens >= tokens;
    const isAllowed = !isConcurrencyBlocked && hasEnoughTokens;

    let waitTimeMs = 0;
    if (!hasEnoughTokens) {
      const deficit = tokens - this.tokens;
      waitTimeMs = Math.ceil((deficit / this.refillRatePerSecond) * 1_000);
    }

    return {
      isAllowed,
      availableTokens: Number(this.tokens.toFixed(2)),
      capacity: this.capacity,
      waitTimeMs,
      activeConcurrency: this.activeConcurrency,
      maxConcurrency: this.maxConcurrency,
    };
  }

  public getAvailableTokens(): number {
    this.refill();
    return Number(this.tokens.toFixed(2));
  }
}

/**
 * Sliding Window Counter tracking request timestamps across a rolling time frame.
 */
export class SlidingWindowRateLimiter {
  private readonly timestamps: number[] = [];
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(maxRequests: number, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  public tryAcquire(now = Date.now()): boolean {
    this.cleanExpired(now);
    if (this.timestamps.length < this.maxRequests) {
      this.timestamps.push(now);
      return true;
    }
    return false;
  }

  public getRemainingRequests(now = Date.now()): number {
    this.cleanExpired(now);
    return Math.max(0, this.maxRequests - this.timestamps.length);
  }

  private cleanExpired(now: number): void {
    const threshold = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! <= threshold) {
      this.timestamps.shift();
    }
  }
}
