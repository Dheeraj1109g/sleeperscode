/**
 * Resilient Retry Policy, Exponential Backoff, and Circuit Breaker Engine.
 *
 * Designed for reliable provider streaming, rate-limit recovery, and RPC calls.
 *
 * @module retryPolicy
 */

export type JitterMode = "full" | "equal" | "decorrelated" | "none";

export interface RetryPolicyConfig {
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly jitterMode: JitterMode;
}

export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 15_000,
  backoffMultiplier: 2.0,
  jitterMode: "full",
};

/**
 * Calculates backoff delay with specified jitter algorithm.
 */
export function calculateBackoffDelay(
  attempt: number,
  config: Partial<RetryPolicyConfig> = {},
  random = Math.random,
): number {
  const merged = { ...DEFAULT_RETRY_POLICY, ...config };
  const safeAttempt = Math.max(0, attempt);

  const rawBackoff = merged.initialDelayMs * Math.pow(merged.backoffMultiplier, safeAttempt);
  const cappedBackoff = Math.min(merged.maxDelayMs, rawBackoff);

  switch (merged.jitterMode) {
    case "none":
      return Math.round(cappedBackoff);

    case "equal": {
      const half = cappedBackoff / 2;
      return Math.round(half + half * random());
    }

    case "decorrelated": {
      const prev = merged.initialDelayMs;
      return Math.round(
        Math.min(merged.maxDelayMs, Math.max(merged.initialDelayMs, prev * 3 * random())),
      );
    }

    case "full":
    default:
      return Math.round(cappedBackoff * random());
  }
}

/**
 * Parses HTTP Retry-After headers into milliseconds.
 * Supports integer seconds (e.g. "120") and HTTP-date strings (e.g. "Wed, 21 Oct 2026 07:28:00 GMT").
 */
export function parseRetryAfterHeader(
  headerValue: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!headerValue || typeof headerValue !== "string") {
    return null;
  }

  const trimmed = headerValue.trim();
  const secondsMatch = /^\d+$/.exec(trimmed);
  if (secondsMatch) {
    const seconds = Number.parseInt(trimmed, 10);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
  }

  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, parsedDate - nowMs);
  }

  return null;
}

export type CircuitBreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly recoveryTimeoutMs: number;
  readonly halfOpenSuccessThreshold: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeoutMs: 30_000,
  halfOpenSuccessThreshold: 2,
};

/**
 * In-memory Circuit Breaker state tracker for external provider endpoints.
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
  }

  public getState(now = Date.now()): CircuitBreakerState {
    if (this.state === "open" && now - this.lastFailureTime >= this.config.recoveryTimeoutMs) {
      this.state = "half-open";
      this.successCount = 0;
    }
    return this.state;
  }

  public canExecute(now = Date.now()): boolean {
    return this.getState(now) !== "open";
  }

  public recordSuccess(): void {
    if (this.state === "half-open") {
      this.successCount += 1;
      if (this.successCount >= this.config.halfOpenSuccessThreshold) {
        this.reset();
      }
    } else if (this.state === "closed") {
      this.failureCount = 0;
    }
  }

  public recordFailure(now = Date.now()): void {
    this.failureCount += 1;
    this.lastFailureTime = now;

    if (this.state === "half-open" || this.failureCount >= this.config.failureThreshold) {
      this.state = "open";
      this.successCount = 0;
    }
  }

  public reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }

  public getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}
