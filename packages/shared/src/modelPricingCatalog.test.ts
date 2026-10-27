import { describe, expect, it } from "vite-plus/test";

import {
  calculateTokenCost,
  evaluateContextWindow,
  lookupModelPricing,
  MODEL_PRICING_CATALOG,
} from "./modelPricingCatalog.ts";

describe("lookupModelPricing", () => {
  it("finds exact model by slug", () => {
    const tier = lookupModelPricing("gemini-3.8-flash");
    expect(tier).toBeDefined();
    expect(tier?.provider).toBe("google");
    expect(tier?.inputPricePerMillion).toBe(0.15);
  });

  it("finds model by prefix match", () => {
    const tier = lookupModelPricing("claude-3-7-sonnet-20260219");
    expect(tier).toBeDefined();
    expect(tier?.modelId).toBe("claude-3-7-sonnet");
  });

  it("returns undefined for unknown models", () => {
    expect(lookupModelPricing("nonexistent-future-model-9000")).toBeUndefined();
  });
});

describe("calculateTokenCost", () => {
  it("computes standard input and output cost correctly", () => {
    const result = calculateTokenCost("gemini-3.8-flash", {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    expect(result.isEstimateTrustworthy).toBe(true);
    expect(result.inputCostUsd).toBe(0.15);
    expect(result.outputCostUsd).toBe(0.3);
    expect(result.totalCostUsd).toBe(0.45);
  });

  it("applies cached input discount when cached tokens are present", () => {
    const result = calculateTokenCost("claude-3-7-sonnet", {
      inputTokens: 1_000_000,
      cachedInputTokens: 800_000,
      outputTokens: 100_000,
    });

    // 200K uncached @ $3.00/M = $0.60
    expect(result.inputCostUsd).toBe(0.6);
    // 800K cached @ $0.30/M = $0.24
    expect(result.cachedInputCostUsd).toBe(0.24);
    // 100K output @ $15.00/M = $1.50
    expect(result.outputCostUsd).toBe(1.5);
    expect(result.totalCostUsd).toBe(2.34);
  });

  it("returns zero cost for free local models", () => {
    const result = calculateTokenCost("local-default", {
      inputTokens: 50_000,
      outputTokens: 10_000,
    });

    expect(result.isEstimateTrustworthy).toBe(true);
    expect(result.totalCostUsd).toBe(0);
  });

  it("marks unknown models as untrustworthy with zero total", () => {
    const result = calculateTokenCost("custom-proprietary-model", {
      inputTokens: 10_000,
      outputTokens: 2_000,
    });

    expect(result.isEstimateTrustworthy).toBe(false);
    expect(result.totalCostUsd).toBe(0);
  });
});

describe("evaluateContextWindow", () => {
  it("evaluates healthy utilization correctly", () => {
    const status = evaluateContextWindow("gemini-3.8-flash", 524_288);
    expect(status.contextWindowTokens).toBe(1_048_576);
    expect(status.remainingTokens).toBe(524_288);
    expect(status.utilizationPercent).toBe(50.0);
    expect(status.isOverLimit).toBe(false);
  });

  it("detects context limit overflow", () => {
    const status = evaluateContextWindow("deepseek-v3", 70_000);
    expect(status.isOverLimit).toBe(true);
    expect(status.remainingTokens).toBe(0);
    expect(status.utilizationPercent).toBe(100.0);
  });

  it("uses fallback window for unregistered models", () => {
    const status = evaluateContextWindow("unknown-endpoint", 64_000, 100_000);
    expect(status.contextWindowTokens).toBe(100_000);
    expect(status.remainingTokens).toBe(36_000);
    expect(status.utilizationPercent).toBe(64.0);
  });
});

describe("MODEL_PRICING_CATALOG", () => {
  it("contains major provider tiers with positive windows", () => {
    expect(MODEL_PRICING_CATALOG.length).toBeGreaterThanOrEqual(8);
    for (const tier of MODEL_PRICING_CATALOG) {
      expect(tier.contextWindowTokens).toBeGreaterThan(0);
      expect(tier.maxOutputTokens).toBeGreaterThan(0);
      expect(tier.inputPricePerMillion).toBeGreaterThanOrEqual(0);
      expect(tier.outputPricePerMillion).toBeGreaterThanOrEqual(0);
    }
  });
});
