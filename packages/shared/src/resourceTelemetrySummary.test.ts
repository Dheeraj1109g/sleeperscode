import type { ResourceTelemetrySnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describeResourceTelemetryStatus,
  formatResourceByteRate,
  formatResourceBytes,
  formatResourceCpuPercent,
  formatResourceCpuTime,
  formatResourceDurationMicros,
  formatResourceSampleInterval,
  isElevatedResourceUsage,
  summarizeResourceTelemetry,
} from "./resourceTelemetrySummary.ts";

const snapshot = {
  sampleIntervalMs: 2_000,
  health: { native: { status: "degraded" } },
  groups: {
    allT3: {
      processCount: 4,
      currentCpuPercent: 12.5,
      currentRssBytes: 25 * 1_024 * 1_024,
      peakRssBytes: 32 * 1_024 * 1_024,
      ioReadBytesPerSecond: 4_096,
      ioWriteBytesPerSecond: 8_192,
    },
    backend: {
      processCount: 1,
      currentCpuPercent: 2,
      currentRssBytes: 1,
      peakRssBytes: 1,
      ioReadBytesPerSecond: 1,
      ioWriteBytesPerSecond: 1,
    },
  },
} as Pick<ResourceTelemetrySnapshot, "groups" | "health" | "sampleIntervalMs">;

describe("resource telemetry usage summary", () => {
  it("uses the all-T3 aggregate without inventing task attribution", () => {
    expect(summarizeResourceTelemetry(snapshot)).toEqual({
      status: "degraded",
      processCount: 4,
      currentCpuPercent: 12.5,
      currentRssBytes: 25 * 1_024 * 1_024,
      peakRssBytes: 32 * 1_024 * 1_024,
      ioReadBytesPerSecond: 4_096,
      ioWriteBytesPerSecond: 8_192,
      sampleIntervalMs: 2_000,
    });
  });

  it("formats bounded display values and monitor states", () => {
    expect(formatResourceBytes(25 * 1_024 * 1_024)).toBe("25.0 MB");
    expect(formatResourceBytes(-1)).toBe("0 B");
    expect(formatResourceBytes(Number.NaN)).toBe("0 B");
    expect(formatResourceCpuPercent(12.5)).toBe("12.5%");
    expect(formatResourceCpuPercent(-0.5)).toBe("0.00%");
    expect(formatResourceCpuPercent(Number.POSITIVE_INFINITY)).toBe("0.00%");
    expect(describeResourceTelemetryStatus("unavailable")).toBe("Unavailable");
  });

  it("formats transfer rates correctly", () => {
    expect(formatResourceByteRate(1_024 * 1_024 * 2.5)).toBe("2.50 MB/s");
    expect(formatResourceByteRate(512)).toBe("512 B/s");
    expect(formatResourceByteRate(0)).toBe("0 B/s");
  });

  it("formats CPU runtime in appropriate units", () => {
    expect(formatResourceCpuTime(4_500)).toBe("4.50s");
    expect(formatResourceCpuTime(45_000)).toBe("45.0s");
    expect(formatResourceCpuTime(120_000)).toBe("2.00m");
    expect(formatResourceCpuTime(7_200_000)).toBe("2.00h");
  });

  it("formats high-resolution duration microseconds", () => {
    expect(formatResourceDurationMicros(450)).toBe("450 µs");
    expect(formatResourceDurationMicros(15_200)).toBe("15.20 ms");
    expect(formatResourceDurationMicros(2_500_000)).toBe("2.50 s");
  });

  it("formats sample intervals into human units", () => {
    expect(formatResourceSampleInterval(500)).toBe("500 ms");
    expect(formatResourceSampleInterval(1_000)).toBe("1 second");
    expect(formatResourceSampleInterval(2_500)).toBe("2.5 seconds");
  });

  it("detects elevated resource usage accurately", () => {
    expect(isElevatedResourceUsage(85, 1_000_000)).toBe(true);
    expect(isElevatedResourceUsage(50, 5 * 1024 * 1024 * 1024)).toBe(true);
    expect(isElevatedResourceUsage(20, 500 * 1024 * 1024)).toBe(false);
  });
});
