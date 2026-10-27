import { describe, expect, it } from "vite-plus/test";

import { calculateNextCronRun, parseCronExpression, parseCronField } from "./cronEngine.ts";

describe("parseCronField", () => {
  it("expands wildcards into full sets", () => {
    const field = parseCronField("*", 0, 5);
    expect(field.isWildcard).toBe(true);
    expect(Array.from(field.values)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("parses ranges into sequential numbers", () => {
    const field = parseCronField("1-4", 0, 10);
    expect(Array.from(field.values)).toEqual([1, 2, 3, 4]);
  });

  it("parses stepped expressions", () => {
    const field = parseCronField("*/15", 0, 59);
    expect(Array.from(field.values)).toEqual([0, 15, 30, 45]);
  });

  it("parses discrete comma-separated lists", () => {
    const field = parseCronField("5,10,25", 0, 59);
    expect(Array.from(field.values)).toEqual([5, 10, 25]);
  });
});

describe("parseCronExpression", () => {
  it("parses standard 5-part cron syntax", () => {
    const parsed = parseCronExpression("*/10 * * * *");
    expect(parsed.hasSeconds).toBe(false);
    expect(parsed.minutes.values.has(0)).toBe(true);
    expect(parsed.minutes.values.has(10)).toBe(true);
    expect(parsed.hours.isWildcard).toBe(true);
  });

  it("rejects expressions with wrong field counts", () => {
    expect(() => parseCronExpression("* * *")).toThrow("Must contain 5 or 6 fields");
  });
});

describe("calculateNextCronRun", () => {
  it("calculates next minute boundary accurately", () => {
    const parsed = parseCronExpression("*/5 * * * *");
    const fixedNow = Date.parse("2026-10-28T12:01:00Z");
    const nextRun = calculateNextCronRun(parsed, fixedNow);

    const expected = Date.parse("2026-10-28T12:05:00Z");
    expect(nextRun).toBe(expected);
  });

  it("calculates next daily run at fixed hour", () => {
    const parsed = parseCronExpression("0 8 * * *"); // 8:00 AM daily
    const fixedNow = Date.parse("2026-10-28T09:00:00Z");
    const nextRun = calculateNextCronRun(parsed, fixedNow);

    const expected = Date.parse("2026-10-29T08:00:00Z");
    expect(nextRun).toBe(expected);
  });
});
