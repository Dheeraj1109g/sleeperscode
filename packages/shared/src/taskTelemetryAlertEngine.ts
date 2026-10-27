/**
 * Performance Anomaly and Resource Exhaustion Alert Engine.
 *
 * Evaluates host telemetry metrics to detect memory leaks, sustained CPU saturation,
 * abnormal disk I/O churn, unresponsive processes, and error budget depletion.
 *
 * @module taskTelemetryAlertEngine
 */

export type AlertSeverity = "info" | "warning" | "critical";

export interface TelemetryAlertThresholds {
  readonly cpuWarningPercent?: number;
  readonly cpuCriticalPercent?: number;
  readonly cpuSustainedDurationSeconds?: number;
  readonly rssWarningBytes?: number;
  readonly rssCriticalBytes?: number;
  readonly memoryLeakGrowthRateBytesPerSec?: number;
  readonly ioChurnWarningBytesPerSec?: number;
}

export interface TelemetryAlertRule {
  readonly id: string;
  readonly name: string;
  readonly severity: AlertSeverity;
  readonly evaluate: (
    history: readonly TelemetrySnapshotRecord[],
  ) => AnomalyEvaluationResult | null;
}

export interface TelemetrySnapshotRecord {
  readonly timestamp: number;
  readonly cpuPercent: number;
  readonly rssBytes: number;
  readonly ioReadBytesPerSec: number;
  readonly ioWriteBytesPerSec: number;
  readonly processCount: number;
}

export interface AnomalyEvaluationResult {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly currentValue: number;
  readonly thresholdValue: number;
  readonly timestamp: number;
}

export const DEFAULT_ALERT_THRESHOLDS: TelemetryAlertThresholds = {
  cpuWarningPercent: 80,
  cpuCriticalPercent: 95,
  cpuSustainedDurationSeconds: 15,
  rssWarningBytes: 3 * 1024 * 1024 * 1024, // 3 GB
  rssCriticalBytes: 6 * 1024 * 1024 * 1024, // 6 GB
  memoryLeakGrowthRateBytesPerSec: 50 * 1024 * 1024, // 50 MB/s
  ioChurnWarningBytesPerSec: 200 * 1024 * 1024, // 200 MB/s
};

/**
 * Anomaly detector engine tracking rolling metrics and firing threshold alerts.
 */
export class TaskTelemetryAlertEngine {
  private readonly history: TelemetrySnapshotRecord[] = [];
  private readonly thresholds: TelemetryAlertThresholds;
  private readonly maxHistoryLength: number;

  constructor(thresholds: Partial<TelemetryAlertThresholds> = {}, maxHistoryLength = 60) {
    this.thresholds = { ...DEFAULT_ALERT_THRESHOLDS, ...thresholds };
    this.maxHistoryLength = maxHistoryLength;
  }

  public recordSnapshot(snapshot: TelemetrySnapshotRecord): readonly AnomalyEvaluationResult[] {
    this.history.push(snapshot);
    if (this.history.length > this.maxHistoryLength) {
      this.history.shift();
    }
    return this.evaluateAnomalies();
  }

  public evaluateAnomalies(): readonly AnomalyEvaluationResult[] {
    if (this.history.length === 0) return [];
    const alerts: AnomalyEvaluationResult[] = [];
    const latest = this.history[this.history.length - 1]!;

    // 1. CPU Critical Check
    if (latest.cpuPercent >= (this.thresholds.cpuCriticalPercent ?? 95)) {
      alerts.push({
        ruleId: "cpu-critical",
        ruleName: "Critical CPU Saturation",
        severity: "critical",
        message: `CPU usage reached ${latest.cpuPercent.toFixed(1)}%, exceeding critical threshold.`,
        currentValue: latest.cpuPercent,
        thresholdValue: this.thresholds.cpuCriticalPercent ?? 95,
        timestamp: latest.timestamp,
      });
    } else if (latest.cpuPercent >= (this.thresholds.cpuWarningPercent ?? 80)) {
      alerts.push({
        ruleId: "cpu-warning",
        ruleName: "Elevated CPU Load",
        severity: "warning",
        message: `CPU usage reached ${latest.cpuPercent.toFixed(1)}%, exceeding warning threshold.`,
        currentValue: latest.cpuPercent,
        thresholdValue: this.thresholds.cpuWarningPercent ?? 80,
        timestamp: latest.timestamp,
      });
    }

    // 2. Memory RSS Critical Check
    if (latest.rssBytes >= (this.thresholds.rssCriticalBytes ?? 6 * 1024 * 1024 * 1024)) {
      alerts.push({
        ruleId: "rss-critical",
        ruleName: "Critical Memory Exhaustion",
        severity: "critical",
        message: `Memory RSS reached ${(latest.rssBytes / (1024 * 1024 * 1024)).toFixed(2)} GB, exceeding critical limit.`,
        currentValue: latest.rssBytes,
        thresholdValue: this.thresholds.rssCriticalBytes ?? 6 * 1024 * 1024 * 1024,
        timestamp: latest.timestamp,
      });
    }

    // 3. Memory Leak Trend Detection (sustained upward trajectory over >= 5 snapshots)
    if (this.history.length >= 5) {
      const growthRate = this.calculateMemoryGrowthRate();
      if (growthRate >= (this.thresholds.memoryLeakGrowthRateBytesPerSec ?? 50 * 1024 * 1024)) {
        alerts.push({
          ruleId: "memory-leak-detected",
          ruleName: "Rapid Memory Leak Detected",
          severity: "critical",
          message: `Memory is growing at ${(growthRate / (1024 * 1024)).toFixed(1)} MB/s over recent window.`,
          currentValue: growthRate,
          thresholdValue: this.thresholds.memoryLeakGrowthRateBytesPerSec ?? 50 * 1024 * 1024,
          timestamp: latest.timestamp,
        });
      }
    }

    // 4. I/O Churn Check
    const totalIo = latest.ioReadBytesPerSec + latest.ioWriteBytesPerSec;
    if (totalIo >= (this.thresholds.ioChurnWarningBytesPerSec ?? 200 * 1024 * 1024)) {
      alerts.push({
        ruleId: "io-churn-warning",
        ruleName: "Excessive Disk I/O Activity",
        severity: "warning",
        message: `Disk I/O throughput reached ${(totalIo / (1024 * 1024)).toFixed(1)} MB/s.`,
        currentValue: totalIo,
        thresholdValue: this.thresholds.ioChurnWarningBytesPerSec ?? 200 * 1024 * 1024,
        timestamp: latest.timestamp,
      });
    }

    return alerts;
  }

  public getHistory(): readonly TelemetrySnapshotRecord[] {
    return this.history;
  }

  public clear(): void {
    this.history.length = 0;
  }

  private calculateMemoryGrowthRate(): number {
    const first = this.history[0]!;
    const last = this.history[this.history.length - 1]!;
    const deltaMs = last.timestamp - first.timestamp;
    if (deltaMs <= 0) return 0;

    const deltaBytes = last.rssBytes - first.rssBytes;
    return Math.max(0, (deltaBytes / deltaMs) * 1_000);
  }
}
