import { describe, expect, it } from "vite-plus/test";

import {
  calculatePercentile,
  calculateTelemetryStats,
  computeEma,
  filterIqrOutliers,
  generateHistogramBins,
} from "./telemetryBenchmark.ts";

describe("calculateTelemetryStats", () => {
  it("calculates accurate mean, min, max, and percentiles", () => {
    const samples = [10, 20, 30, 40, 50];
    const stats = calculateTelemetryStats(samples);

    expect(stats.count).toBe(5);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(50);
    expect(stats.mean).toBe(30);
    expect(stats.median).toBe(30);
    expect(stats.p50).toBe(30);
    expect(stats.p90).toBe(46);
  });

  it("handles empty arrays gracefully with zeroes", () => {
    const stats = calculateTelemetryStats([]);
    expect(stats.count).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.p99).toBe(0);
  });

  it("filters out non-finite inputs", () => {
    const samples = [10, Number.NaN, 20, Number.POSITIVE_INFINITY, 30];
    const stats = calculateTelemetryStats(samples);
    expect(stats.count).toBe(3);
    expect(stats.mean).toBe(20);
  });
});

describe("calculatePercentile", () => {
  it("interpolates percentiles precisely", () => {
    const sorted = [0, 100];
    expect(calculatePercentile(sorted, 50)).toBe(50);
    expect(calculatePercentile(sorted, 25)).toBe(25);
    expect(calculatePercentile(sorted, 75)).toBe(75);
  });

  it("returns single element for length-1 arrays", () => {
    expect(calculatePercentile([42], 99)).toBe(42);
  });
});

describe("filterIqrOutliers", () => {
  it("removes extreme values outside 1.5 * IQR", () => {
    const samples = [10, 12, 11, 13, 12, 1000]; // 1000 is obvious outlier
    const filtered = filterIqrOutliers(samples);

    expect(filtered).not.toContain(1000);
    expect(filtered).toHaveLength(5);
  });

  it("preserves small arrays untouched", () => {
    const small = [5, 500];
    expect(filterIqrOutliers(small)).toEqual([5, 500]);
  });
});

describe("computeEma", () => {
  it("smoothes sequential values properly", () => {
    const series = [100, 100, 100, 200];
    const ema = computeEma(series, 0.5);

    expect(ema).toHaveLength(4);
    expect(ema[0]).toBe(100);
    expect(ema[1]).toBe(100);
    expect(ema[2]).toBe(100);
    expect(ema[3]).toBe(150);
  });
});

describe("generateHistogramBins", () => {
  it("bins data into uniform intervals summing to 100%", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const bins = generateHistogramBins(samples, 5);

    expect(bins).toHaveLength(5);
    const totalCount = bins.reduce((acc, b) => acc + b.count, 0);
    expect(totalCount).toBe(10);
    const totalPercentage = bins.reduce((acc, b) => acc + b.percentage, 0);
    expect(Math.round(totalPercentage)).toBe(100);
  });
});
