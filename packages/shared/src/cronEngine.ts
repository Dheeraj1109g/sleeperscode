/**
 * Cron Expression Parser and Recurring Task Scheduling Engine.
 *
 * Implements standard 5-field (and optional 6-field with seconds) cron parsing,
 * next-run timestamp calculation, catch-up scheduling, and interval matching.
 *
 * @module cronEngine
 */

export interface ParsedCronField {
  readonly raw: string;
  readonly values: ReadonlySet<number>;
  readonly isWildcard: boolean;
}

export interface ParsedCronExpression {
  readonly expression: string;
  readonly hasSeconds: boolean;
  readonly seconds: ParsedCronField;
  readonly minutes: ParsedCronField;
  readonly hours: ParsedCronField;
  readonly daysOfMonth: ParsedCronField;
  readonly months: ParsedCronField;
  readonly daysOfWeek: ParsedCronField;
}

export interface ScheduledTask<T = unknown> {
  readonly id: string;
  readonly cronExpression: string;
  readonly parsedCron: ParsedCronExpression;
  readonly payload?: T;
  readonly lastRunTimestamp?: number;
  readonly nextRunTimestamp: number;
  readonly enabled: boolean;
}

const FIELD_CONSTRAINTS = {
  seconds: { min: 0, max: 59 },
  minutes: { min: 0, max: 59 },
  hours: { min: 0, max: 23 },
  daysOfMonth: { min: 1, max: 31 },
  months: { min: 1, max: 12 },
  daysOfWeek: { min: 0, max: 6 }, // 0 = Sunday, 6 = Saturday
};

/**
 * Parses a single field component (e.g. "*", "0", "1,15,30", "1-5", "star/10").
 */
export function parseCronField(fieldStr: string, min: number, max: number): ParsedCronField {
  const trimmed = fieldStr.trim();
  const values = new Set<number>();
  const isWildcard = trimmed === "*" || trimmed === "?";

  if (isWildcard) {
    for (let i = min; i <= max; i++) values.add(i);
    return { raw: trimmed, values, isWildcard: true };
  }

  const parts = trimmed.split(",");
  for (const part of parts) {
    const stepMatch = /^(\*|\d+-\d+|\d+)\/(\d+)$/.exec(part);
    if (stepMatch) {
      const base = stepMatch[1]!;
      const step = Number.parseInt(stepMatch[2]!, 10);
      let start = min;
      let end = max;

      if (base !== "*") {
        if (base.includes("-")) {
          const [s, e] = base.split("-").map((n) => Number.parseInt(n, 10));
          start = s ?? min;
          end = e ?? max;
        } else {
          start = Number.parseInt(base, 10);
        }
      }

      for (let i = start; i <= end; i += step) {
        if (i >= min && i <= max) values.add(i);
      }
      continue;
    }

    const rangeMatch = /^(\d+)-(\d+)$/.exec(part);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1]!, 10);
      const end = Number.parseInt(rangeMatch[2]!, 10);
      for (let i = start; i <= end; i++) {
        if (i >= min && i <= max) values.add(i);
      }
      continue;
    }

    const singleNum = Number.parseInt(part, 10);
    if (Number.isFinite(singleNum) && singleNum >= min && singleNum <= max) {
      values.add(singleNum);
    }
  }

  return { raw: trimmed, values, isWildcard: false };
}

/**
 * Parses a full 5-part or 6-part cron expression string.
 */
export function parseCronExpression(cronStr: string): ParsedCronExpression {
  const parts = cronStr.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5 && parts.length !== 6) {
    throw new Error(`Invalid cron format: '${cronStr}'. Must contain 5 or 6 fields.`);
  }

  const hasSeconds = parts.length === 6;
  const secPart = hasSeconds ? parts[0]! : "0";
  const minPart = hasSeconds ? parts[1]! : parts[0]!;
  const hourPart = hasSeconds ? parts[2]! : parts[1]!;
  const domPart = hasSeconds ? parts[3]! : parts[2]!;
  const monPart = hasSeconds ? parts[4]! : parts[3]!;
  const dowPart = hasSeconds ? parts[5]! : parts[4]!;

  return {
    expression: cronStr,
    hasSeconds,
    seconds: parseCronField(secPart, FIELD_CONSTRAINTS.seconds.min, FIELD_CONSTRAINTS.seconds.max),
    minutes: parseCronField(minPart, FIELD_CONSTRAINTS.minutes.min, FIELD_CONSTRAINTS.minutes.max),
    hours: parseCronField(hourPart, FIELD_CONSTRAINTS.hours.min, FIELD_CONSTRAINTS.hours.max),
    daysOfMonth: parseCronField(
      domPart,
      FIELD_CONSTRAINTS.daysOfMonth.min,
      FIELD_CONSTRAINTS.daysOfMonth.max,
    ),
    months: parseCronField(monPart, FIELD_CONSTRAINTS.months.min, FIELD_CONSTRAINTS.months.max),
    daysOfWeek: parseCronField(
      dowPart,
      FIELD_CONSTRAINTS.daysOfWeek.min,
      FIELD_CONSTRAINTS.daysOfWeek.max,
    ),
  };
}

/**
 * Calculates the next matching execution timestamp after `afterTimestamp`.
 */
export function calculateNextCronRun(
  parsed: ParsedCronExpression,
  afterTimestamp = Date.now(),
): number {
  const current = new Date(afterTimestamp);
  // Advance by 1 second or 1 minute to prevent matching current millisecond
  const step = parsed.hasSeconds ? 1_000 : 60_000;
  let cursor = new Date(Math.floor((current.getTime() + step) / step) * step);

  const maxScanMinutes = 525_600; // scan at most 1 year forward
  let scans = 0;

  while (scans < maxScanMinutes) {
    const s = cursor.getUTCSeconds();
    const m = cursor.getUTCMinutes();
    const h = cursor.getUTCHours();
    const dom = cursor.getUTCDate();
    const mon = cursor.getUTCMonth() + 1;
    const dow = cursor.getUTCDay();

    if (
      parsed.seconds.values.has(s) &&
      parsed.minutes.values.has(m) &&
      parsed.hours.values.has(h) &&
      parsed.daysOfMonth.values.has(dom) &&
      parsed.months.values.has(mon) &&
      parsed.daysOfWeek.values.has(dow)
    ) {
      return cursor.getTime();
    }

    cursor = new Date(cursor.getTime() + step);
    scans++;
  }

  return 0; // No run found within 1 year
}
