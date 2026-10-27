import { describe, expect, it } from "vite-plus/test";

import {
  TaskTelemetryAlertEngine,
  type TelemetrySnapshotRecord,
} from "./taskTelemetryAlertEngine.ts";

describe("TaskTelemetryAlertEngine", () => {
  it("fires warning alert when CPU exceeds warning threshold", () => {
    const engine = new TaskTelemetryAlertEngine({ cpuWarningPercent: 75, cpuCriticalPercent: 90 });
    const alerts = engine.recordSnapshot({
      timestamp: 1000,
      cpuPercent: 82,
      rssBytes: 500 * 1024 * 1024,
      ioReadBytesPerSec: 0,
      ioWriteBytesPerSec: 0,
      processCount: 3,
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.ruleId).toBe("cpu-warning");
    expect(alerts[0]?.severity).toBe("warning");
  });

  it("fires critical alert when CPU reaches critical saturation", () => {
    const engine = new TaskTelemetryAlertEngine({ cpuCriticalPercent: 90 });
    const alerts = engine.recordSnapshot({
      timestamp: 2000,
      cpuPercent: 96,
      rssBytes: 500 * 1024 * 1024,
      ioReadBytesPerSec: 0,
      ioWriteBytesPerSec: 0,
      processCount: 3,
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.ruleId).toBe("cpu-critical");
    expect(alerts[0]?.severity).toBe("critical");
  });

  it("detects rapid memory leak trajectory over multiple snapshots", () => {
    const engine = new TaskTelemetryAlertEngine({
      memoryLeakGrowthRateBytesPerSec: 50 * 1024 * 1024,
    });

    // Simulate 5 snapshots with 100MB growth per second (leak)
    let alerts: readonly any[] = [];
    for (let i = 0; i < 5; i++) {
      alerts = engine.recordSnapshot({
        timestamp: 1000 + i * 1000,
        cpuPercent: 10,
        rssBytes: (500 + i * 100) * 1024 * 1024,
        ioReadBytesPerSec: 0,
        ioWriteBytesPerSec: 0,
        processCount: 2,
      });
    }

    const leakAlert = alerts.find((a) => a.ruleId === "memory-leak-detected");
    expect(leakAlert).toBeDefined();
    expect(leakAlert?.severity).toBe("critical");
  });

  it("flags excessive disk I/O churn", () => {
    const engine = new TaskTelemetryAlertEngine({ ioChurnWarningBytesPerSec: 100 * 1024 * 1024 });
    const alerts = engine.recordSnapshot({
      timestamp: 1000,
      cpuPercent: 20,
      rssBytes: 200 * 1024 * 1024,
      ioReadBytesPerSec: 80 * 1024 * 1024,
      ioWriteBytesPerSec: 50 * 1024 * 1024, // Total 130 MB/s > 100 MB/s
      processCount: 4,
    });

    const ioAlert = alerts.find((a) => a.ruleId === "io-churn-warning");
    expect(ioAlert).toBeDefined();
  });
});
