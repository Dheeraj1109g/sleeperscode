/**
 * Model Token Pricing Catalog and Context Window Estimator.
 *
 * Provides accurate rate tables and cost estimation for supported AI coding providers
 * (Gemini, Claude, GPT/Codex, DeepSeek, Grok, and local models).
 *
 * @module modelPricingCatalog
 */

export interface ModelPricingTier {
  readonly modelId: string;
  readonly provider: "google" | "anthropic" | "openai" | "deepseek" | "xai" | "local";
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  /** Price in USD per 1,000,000 input tokens. */
  readonly inputPricePerMillion: number;
  /** Price in USD per 1,000,000 output tokens. */
  readonly outputPricePerMillion: number;
  /** Price in USD per 1,000,000 cached input tokens (if supported). */
  readonly cachedInputPricePerMillion?: number;
  /** Price in USD per 1,000,000 reasoning / thinking tokens (if separate). */
  readonly reasoningPricePerMillion?: number;
}

export interface CostEstimateResult {
  readonly modelId: string;
  readonly inputCostUsd: number;
  readonly outputCostUsd: number;
  readonly cachedInputCostUsd: number;
  readonly reasoningCostUsd: number;
  readonly totalCostUsd: number;
  readonly isEstimateTrustworthy: boolean;
}

export interface ContextWindowStatus {
  readonly contextWindowTokens: number;
  readonly totalUsedTokens: number;
  readonly remainingTokens: number;
  readonly utilizationPercent: number;
  readonly isOverLimit: boolean;
}

/**
 * Verified pricing and window catalog for major coding models.
 */
export const MODEL_PRICING_CATALOG: readonly ModelPricingTier[] = [
  // Google Gemini Models
  {
    modelId: "gemini-3.8-flash",
    provider: "google",
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    cachedInputPricePerMillion: 0.0375,
  },
  {
    modelId: "gemini-3.8-pro",
    provider: "google",
    contextWindowTokens: 2_097_152,
    maxOutputTokens: 65_536,
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 5.0,
    cachedInputPricePerMillion: 0.3125,
  },
  {
    modelId: "gemini-2.5-flash",
    provider: "google",
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 8_192,
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
    cachedInputPricePerMillion: 0.01875,
  },
  // Anthropic Claude Models
  {
    modelId: "claude-3-7-sonnet",
    provider: "anthropic",
    contextWindowTokens: 200_000,
    maxOutputTokens: 64_000,
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cachedInputPricePerMillion: 0.3,
    reasoningPricePerMillion: 15.0,
  },
  {
    modelId: "claude-3-5-haiku",
    provider: "anthropic",
    contextWindowTokens: 200_000,
    maxOutputTokens: 8_192,
    inputPricePerMillion: 0.8,
    outputPricePerMillion: 4.0,
    cachedInputPricePerMillion: 0.08,
  },
  // OpenAI Models
  {
    modelId: "gpt-4o",
    provider: "openai",
    contextWindowTokens: 128_000,
    maxOutputTokens: 16_384,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
    cachedInputPricePerMillion: 1.25,
  },
  {
    modelId: "o3-mini",
    provider: "openai",
    contextWindowTokens: 200_000,
    maxOutputTokens: 100_000,
    inputPricePerMillion: 1.1,
    outputPricePerMillion: 4.4,
    cachedInputPricePerMillion: 0.55,
  },
  // DeepSeek Models
  {
    modelId: "deepseek-v3",
    provider: "deepseek",
    contextWindowTokens: 64_000,
    maxOutputTokens: 8_192,
    inputPricePerMillion: 0.14,
    outputPricePerMillion: 0.28,
    cachedInputPricePerMillion: 0.014,
  },
  {
    modelId: "deepseek-r1",
    provider: "deepseek",
    contextWindowTokens: 64_000,
    maxOutputTokens: 8_192,
    inputPricePerMillion: 0.55,
    outputPricePerMillion: 2.19,
    cachedInputPricePerMillion: 0.14,
  },
  // Local Models (Ollama, LM Studio, etc.)
  {
    modelId: "local-default",
    provider: "local",
    contextWindowTokens: 32_768,
    maxOutputTokens: 4_096,
    inputPricePerMillion: 0.0,
    outputPricePerMillion: 0.0,
    cachedInputPricePerMillion: 0.0,
  },
];

/**
 * Finds a model pricing tier by its identifier or matching prefix.
 */
export function lookupModelPricing(modelId: string): ModelPricingTier | undefined {
  const normalized = modelId.toLowerCase().trim();
  const exact = MODEL_PRICING_CATALOG.find((tier) => tier.modelId === normalized);
  if (exact) return exact;

  return MODEL_PRICING_CATALOG.find((tier) => normalized.startsWith(tier.modelId));
}

/**
 * Calculates estimated cost in USD for a given token usage breakdown.
 */
export function calculateTokenCost(
  modelId: string,
  usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cachedInputTokens?: number;
    readonly reasoningTokens?: number;
  },
): CostEstimateResult {
  const tier = lookupModelPricing(modelId);
  if (!tier) {
    return {
      modelId,
      inputCostUsd: 0,
      outputCostUsd: 0,
      cachedInputCostUsd: 0,
      reasoningCostUsd: 0,
      totalCostUsd: 0,
      isEstimateTrustworthy: false,
    };
  }

  const uncachedInputTokens = Math.max(0, usage.inputTokens - (usage.cachedInputTokens ?? 0));
  const inputCostUsd = (uncachedInputTokens / 1_000_000) * tier.inputPricePerMillion;

  const cachedInputRate = tier.cachedInputPricePerMillion ?? tier.inputPricePerMillion;
  const cachedInputCostUsd = ((usage.cachedInputTokens ?? 0) / 1_000_000) * cachedInputRate;

  const outputCostUsd = (Math.max(0, usage.outputTokens) / 1_000_000) * tier.outputPricePerMillion;

  const reasoningRate = tier.reasoningPricePerMillion ?? tier.outputPricePerMillion;
  const reasoningCostUsd = ((usage.reasoningTokens ?? 0) / 1_000_000) * reasoningRate;

  const totalCostUsd = inputCostUsd + cachedInputCostUsd + outputCostUsd + reasoningCostUsd;

  return {
    modelId: tier.modelId,
    inputCostUsd: roundCurrency(inputCostUsd),
    outputCostUsd: roundCurrency(outputCostUsd),
    cachedInputCostUsd: roundCurrency(cachedInputCostUsd),
    reasoningCostUsd: roundCurrency(reasoningCostUsd),
    totalCostUsd: roundCurrency(totalCostUsd),
    isEstimateTrustworthy: true,
  };
}

/**
 * Computes remaining context window budget and utilization ratio.
 */
export function evaluateContextWindow(
  modelId: string,
  currentUsedTokens: number,
  fallbackWindowTokens = 128_000,
): ContextWindowStatus {
  const tier = lookupModelPricing(modelId);
  const contextWindowTokens = tier ? tier.contextWindowTokens : fallbackWindowTokens;
  const totalUsedTokens = Math.max(0, currentUsedTokens);
  const remainingTokens = Math.max(0, contextWindowTokens - totalUsedTokens);
  const utilizationPercent = Math.min(100, (totalUsedTokens / contextWindowTokens) * 100);
  const isOverLimit = totalUsedTokens > contextWindowTokens;

  return {
    contextWindowTokens,
    totalUsedTokens,
    remainingTokens,
    utilizationPercent: Number(utilizationPercent.toFixed(2)),
    isOverLimit,
  };
}

function roundCurrency(amount: number): number {
  return Number(amount.toFixed(6));
}
