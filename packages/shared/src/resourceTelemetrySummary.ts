import type { ResourceTelemetrySnapshot, ResourceTelemetrySourceStatus } from "@t3tools/contracts";

/**
 * A compact, host-scoped view of resource telemetry for product surfaces.
 *
 * This deliberately keeps the monitor's aggregate boundaries intact. It is
 * not task, provider, or whole-machine attribution.
 */
export interface ResourceTelemetryUsageSummary {
  readonly status: ResourceTelemetrySourceStatus;
  readonly processCount: number;
  readonly currentCpuPercent: number;
  readonly currentRssBytes: number;
  readonly peakRssBytes: number;
  readonly ioReadBytesPerSecond: number;
  readonly ioWriteBytesPerSecond: number;
  readonly sampleIntervalMs: number;
}

export function summarizeResourceTelemetry(
  snapshot: Pick<ResourceTelemetrySnapshot, "groups" | "health" | "sampleIntervalMs">,
): ResourceTelemetryUsageSummary {
  const aggregate = snapshot.groups.allT3;
  return {
    status: snapshot.health.native.status,
    processCount: aggregate.processCount,
    currentCpuPercent: aggregate.currentCpuPercent,
    currentRssBytes: aggregate.currentRssBytes,
    peakRssBytes: aggregate.peakRssBytes,
    ioReadBytesPerSecond: aggregate.ioReadBytesPerSecond,
    ioWriteBytesPerSecond: aggregate.ioWriteBytesPerSecond,
    sampleIntervalMs: snapshot.sampleIntervalMs,
  };
}

export function formatResourceBytes(value: number): string {
  const bytes = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let next = bytes;
  let unitIndex = -1;
  do {
    next /= 1_024;
    unitIndex += 1;
  } while (next >= 1_024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 100 ? 0 : next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function formatResourceCpuPercent(value: number): string {
  const percent = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${percent.toFixed(percent >= 100 ? 0 : percent >= 10 ? 1 : 2)}%`;
}

export function describeResourceTelemetryStatus(status: ResourceTelemetrySourceStatus): string {
  switch (status) {
    case "healthy":
      return "Live";
    case "starting":
      return "Starting";
    case "degraded":
      return "Degraded";
    case "unavailable":
      return "Unavailable";
    case "stopped":
      return "Stopped";
  }
}

/**
 * Formats data transfer rates (bytes per second) into a human-readable string.
 *
 * @example
 * formatResourceByteRate(1024 * 1024 * 1.5) // "1.50 MB/s"
 */
export function formatResourceByteRate(bytesPerSecond: number): string {
  return `${formatResourceBytes(bytesPerSecond)}/s`;
}

/**
 * Formats CPU runtime milliseconds into seconds, minutes, or hours.
 *
 * @example
 * formatResourceCpuTime(4500) // "4.50s"
 * formatResourceCpuTime(120_000) // "2.0m"
 */
export function formatResourceCpuTime(valueMs: number): string {
  const seconds = Number.isFinite(valueMs) ? Math.max(0, valueMs) / 1_000 : 0;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes >= 10 ? 1 : 2)}m`;
  return `${(minutes / 60).toFixed(2)}h`;
}

/**
 * Formats high-resolution microsecond durations into microseconds, milliseconds, or seconds.
 *
 * @example
 * formatResourceDurationMicros(450) // "450 µs"
 * formatResourceDurationMicros(15_200) // "15.20 ms"
 */
export function formatResourceDurationMicros(value: number): string {
  const micros = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (micros < 1_000) return `${Math.round(micros)} µs`;
  if (micros < 1_000_000) return `${(micros / 1_000).toFixed(2)} ms`;
  return `${(micros / 1_000_000).toFixed(2)} s`;
}

/**
 * Formats a telemetry sampling interval in milliseconds into human-readable text.
 *
 * @example
 * formatResourceSampleInterval(500) // "500 ms"
 * formatResourceSampleInterval(1000) // "1 second"
 * formatResourceSampleInterval(2000) // "2 seconds"
 */
export function formatResourceSampleInterval(valueMs: number): string {
  const ms = Number.isFinite(valueMs) ? Math.max(0, valueMs) : 0;
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1_000;
  const formatted = seconds.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return `${formatted} ${seconds === 1 ? "second" : "seconds"}`;
}

/**
 * Assesses whether resource consumption exceeds warning thresholds.
 */
export function isElevatedResourceUsage(
  cpuPercent: number,
  rssBytes: number,
  thresholds: {
    cpuThresholdPercent?: number;
    rssThresholdBytes?: number;
  } = {},
): boolean {
  const { cpuThresholdPercent = 80, rssThresholdBytes = 4 * 1024 * 1024 * 1024 } = thresholds;
  return cpuPercent >= cpuThresholdPercent || rssBytes >= rssThresholdBytes;
}
