import { describe, expect, it } from "vite-plus/test";

import {
  calculateDailyAverageTokens,
  formatCostDeltaPercent,
  formatCount,
  formatDayShort,
  formatDurationHuman,
  formatObservedUsageCost,
  formatPercent,
  formatTokenRate,
  formatTokens,
  summarizeUsageCost,
} from "./usageFormat.ts";

describe("summarizeUsageCost", () => {
  it("does not present partial pricing as a complete total", () => {
    expect(summarizeUsageCost(0)).toEqual({
      label: "Raw token cost",
      detail: "* if billed at full API rate",
    });
    expect(summarizeUsageCost(0.2)).toEqual({
      label: "Priced token cost",
      detail: "Excludes observed usage without a trustworthy price.",
    });
  });
});

describe("formatObservedUsageCost", () => {
  it("does not render unpriced observed tokens as free usage", () => {
    expect(
      formatObservedUsageCost({
        costUsd: 0,
        totalTokens: 25_200,
        hasPricedUsage: false,
        hasUnpricedUsage: true,
      }),
    ).toBe("N/A");
  });

  it("marks mixed price coverage without hiding the priced amount", () => {
    expect(
      formatObservedUsageCost({
        costUsd: 12.5,
        totalTokens: 25_200,
        hasPricedUsage: true,
        hasUnpricedUsage: true,
      }),
    ).toBe("$12.50*");
  });
});

describe("formatTokenRate", () => {
  it("formats tokens per second into human units", () => {
    expect(formatTokenRate(45.2)).toBe("45.2 tok/s");
    expect(formatTokenRate(1_500)).toBe("1.5K tok/s");
    expect(formatTokenRate(2_500_000)).toBe("2.5M tok/s");
    expect(formatTokenRate(0)).toBe("0.00 tok/s");
  });
});

describe("formatDurationHuman", () => {
  it("formats millisecond durations concisely", () => {
    expect(formatDurationHuman(450)).toBe("450ms");
    expect(formatDurationHuman(12_400)).toBe("12.4s");
    expect(formatDurationHuman(135_000)).toBe("2m 15s");
    expect(formatDurationHuman(3_660_000)).toBe("1h 1m");
  });
});

describe("formatCostDeltaPercent", () => {
  it("formats cost deltas with signed percentages", () => {
    expect(formatCostDeltaPercent(15, 10)).toBe("+50.0%");
    expect(formatCostDeltaPercent(8, 10)).toBe("-20.0%");
    expect(formatCostDeltaPercent(10, 0)).toBe("+100.0%");
    expect(formatCostDeltaPercent(10, 10)).toBe("+0.0%");
  });
});

describe("calculateDailyAverageTokens", () => {
  it("calculates daily average tokens accurately", () => {
    expect(calculateDailyAverageTokens(30_000, 30)).toBe(1_000);
    expect(calculateDailyAverageTokens(10_000, 0)).toBe(0);
    expect(calculateDailyAverageTokens(0, 7)).toBe(0);
  });
});

describe("formatTokens and formatCount", () => {
  it("formats compact tokens correctly", () => {
    expect(formatTokens(804_000)).toBe("804K");
    expect(formatTokens(76_700_000)).toBe("76.7M");
    expect(formatTokens(19_900_000_000)).toBe("19.9B");
  });

  it("formats integer counts with comma separation", () => {
    expect(formatCount(12345)).toBe("12,345");
  });

  it("formats percentages correctly", () => {
    expect(formatPercent(0.125)).toBe("12.5%");
  });

  it("formats day short string", () => {
    expect(formatDayShort("2026-08-07")).toBe("Aug 7");
  });
});
