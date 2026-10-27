import { describe, expect, it } from "vite-plus/test";

import {
  matchCommandAutocomplete,
  parseCommandLine,
  validateCommand,
} from "./agentCommandValidator.ts";
import { calculateDiffStats, parseUnifiedDiff } from "./diffParser.ts";
import {
  calculateTokenCost,
  evaluateContextWindow,
  lookupModelPricing,
} from "./modelPricingCatalog.ts";
import { calculateBackoffDelay, CircuitBreaker, parseRetryAfterHeader } from "./retryPolicy.ts";
import { parseAnsiStream, tokensToPlainText } from "./terminalAnsiParser.ts";
import { calculateTelemetryStats, computeEma, filterIqrOutliers } from "./telemetryBenchmark.ts";

describe("Integrated Coding Agent Workflow Suite", () => {
  it("processes command -> calculates model cost -> formats terminal output", () => {
    // 1. Validate slash command
    const parsed = parseCommandLine("/plan --scope=backend --strict");
    const validation = validateCommand(parsed);
    expect(validation.isValid).toBe(true);

    // 2. Autocomplete lookup
    const suggestions = matchCommandAutocomplete("pl");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.command).toBe("/plan");

    // 3. Model token cost and context window verification
    const tier = lookupModelPricing("gemini-3.8-flash");
    expect(tier).toBeDefined();

    const cost = calculateTokenCost("gemini-3.8-flash", {
      inputTokens: 100_000,
      outputTokens: 25_000,
    });
    expect(cost.isEstimateTrustworthy).toBe(true);
    expect(cost.totalCostUsd).toBeGreaterThan(0);

    const window = evaluateContextWindow("gemini-3.8-flash", 125_000);
    expect(window.isOverLimit).toBe(false);
    expect(window.remainingTokens).toBeGreaterThan(0);

    // 4. Terminal rendering
    const terminalRaw = "\x1b[1;32mExecution Plan:\x1b[0m Ready for review";
    const tokens = parseAnsiStream(terminalRaw);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokensToPlainText(tokens)).toBe("Execution Plan: Ready for review");
  });

  it("evaluates telemetry statistics with retry resilience", () => {
    // 1. Benchmark statistics
    const latencies = [120, 135, 140, 150, 145, 130, 9999]; // 9999 outlier
    const filtered = filterIqrOutliers(latencies);
    expect(filtered).not.toContain(9999);

    const stats = calculateTelemetryStats(filtered);
    expect(stats.count).toBe(6);
    expect(stats.mean).toBeGreaterThan(100);

    const ema = computeEma(filtered, 0.3);
    expect(ema).toHaveLength(6);

    // 2. Retry policy & circuit breaker
    const delay = calculateBackoffDelay(1, { jitterMode: "none", initialDelayMs: 250 });
    expect(delay).toBe(500);

    const retryMs = parseRetryAfterHeader("60");
    expect(retryMs).toBe(60_000);

    const breaker = new CircuitBreaker({ failureThreshold: 2 });
    expect(breaker.canExecute()).toBe(true);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.canExecute()).toBe(false);
  });

  it("parses code patches and computes churn delta", () => {
    const rawDiff = `diff --git a/server.ts b/server.ts
index 0001..0002 100644
--- a/server.ts
+++ b/server.ts
@@ -10,3 +10,4 @@ export function startServer() {
   console.log("Starting server...");
+  // Setup health check
   return true;
 }
`;
    const files = parseUnifiedDiff(rawDiff);
    expect(files).toHaveLength(1);

    const summary = calculateDiffStats(files);
    expect(summary.totalFilesChanged).toBe(1);
    expect(summary.totalAdditions).toBe(1);
    expect(summary.totalDeletions).toBe(0);
    expect(summary.netLineDelta).toBe(1);
  });
});
