// @effect-diagnostics globalDate:off -- Usage windows are calendar days in the viewer's zone, derived from wall-clock "now" via Intl.
/**
 * Display formatting for the usage page.
 *
 * @module usageFormat
 */
import { UsageDay, type UsageSummaryInput } from "@t3tools/contracts";

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INTEGER = new Intl.NumberFormat("en-US");

export function formatUsd(value: number): string {
  return CURRENCY.format(value);
}

/**
 * Cost is unknown, rather than zero, when a provider reported tokens without a
 * trustworthy rate. A trailing star means the displayed amount is only the
 * priced portion of mixed usage.
 */
export function formatObservedUsageCost(input: {
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly hasPricedUsage: boolean;
  readonly hasUnpricedUsage: boolean;
}): string {
  if (!input.hasPricedUsage && input.totalTokens > 0) return "N/A";
  const formatted = formatUsd(input.costUsd);
  return input.hasUnpricedUsage ? `${formatted}*` : formatted;
}

/** Copy shared by web and mobile when some observed usage has no verified rate. */
export function summarizeUsageCost(unpricedShare: number): {
  readonly label: string;
  readonly detail: string;
} {
  return unpricedShare > 0
    ? {
        label: "Priced token cost",
        detail: "Excludes observed usage without a trustworthy price.",
      }
    : { label: "Raw token cost", detail: "* if billed at full API rate" };
}

export function formatCount(value: number): string {
  return INTEGER.format(Math.round(value));
}

/**
 * Compacts a token count to three significant figures with a unit suffix, so
 * columns of numbers line up at a glance (`19.9B`, `76.7M`, `804K`).
 */
export function formatTokens(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${trim(value / 1e12)}T`;
  if (abs >= 1e9) return `${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3)}K`;
  return INTEGER.format(Math.round(value));
}

function trim(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.0+$/, "");
}

export function formatPercent(share: number, digits = 1): string {
  return `${(share * 100).toFixed(digits)}%`;
}

/** `2026-08-07` to `Aug 7`. */
export function formatDayShort(day: string): string {
  const [year, month, dayOfMonth] = day.split("-").map((part) => Number(part));
  if (year === undefined || month === undefined || dayOfMonth === undefined) return day;
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${MONTHS[month - 1] ?? ""} ${dayOfMonth}`;
}

/** Inclusive day list between two `YYYY-MM-DD` bounds. */
export function enumerateDays(sinceDay: string, untilDay: string): readonly string[] {
  const days: string[] = [];
  const start = Date.parse(`${sinceDay}T00:00:00Z`);
  const end = Date.parse(`${untilDay}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return days;

  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * The window the page requests, expressed in the viewer's own time zone so days
 * line up with what they actually experienced.
 */
export function makeWindow(days: number, now = new Date()): UsageSummaryInput {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const untilDay = format.format(now);
  // Subtracting fixed milliseconds from `now` lands on the wrong calendar day
  // around a DST transition. Only "today" needs the zone; the window start is
  // pure calendar arithmetic on that day, done in UTC where days are uniform.
  const [year = 0, month = 1, dayOfMonth = 1] = untilDay
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  const start = new Date(Date.UTC(year, month - 1, dayOfMonth - (days - 1)));
  return {
    sinceDay: UsageDay.make(start.toISOString().slice(0, 10)),
    untilDay: UsageDay.make(untilDay),
    timeZone,
  };
}

/**
 * Formats real-time token generation velocity into a readable string.
 *
 * @example
 * formatTokenRate(45.2) // "45.2 tok/s"
 * formatTokenRate(1200) // "1.2K tok/s"
 */
export function formatTokenRate(tokensPerSecond: number): string {
  const rate = Number.isFinite(tokensPerSecond) ? Math.max(0, tokensPerSecond) : 0;
  if (rate >= 1e6) return `${(rate / 1e6).toFixed(1)}M tok/s`;
  if (rate >= 1e3) return `${(rate / 1e3).toFixed(1)}K tok/s`;
  return `${rate.toFixed(rate >= 10 ? 1 : 2)} tok/s`;
}

/**
 * Formats turn or execution duration in milliseconds into a concise human string.
 *
 * @example
 * formatDurationHuman(450) // "450ms"
 * formatDurationHuman(12_400) // "12.4s"
 * formatDurationHuman(135_000) // "2m 15s"
 */
export function formatDurationHuman(ms: number): string {
  const elapsed = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (elapsed < 1_000) return `${Math.round(elapsed)}ms`;
  const totalSeconds = elapsed / 1_000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = Math.round(totalSeconds % 60);
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Formats a cost comparison percentage with sign.
 *
 * @example
 * formatCostDeltaPercent(15, 10) // "+50.0%"
 * formatCostDeltaPercent(8, 10)  // "-20.0%"
 * formatCostDeltaPercent(10, 0)  // "+100.0%"
 */
export function formatCostDeltaPercent(currentCost: number, previousCost: number): string {
  if (!Number.isFinite(currentCost) || !Number.isFinite(previousCost) || previousCost <= 0) {
    return currentCost > 0 ? "+100.0%" : "+0.0%";
  }
  const delta = ((currentCost - previousCost) / previousCost) * 100;
  const sign = delta > 0 ? "+" : delta < 0 ? "" : "+";
  return `${sign}${delta.toFixed(1)}%`;
}

/**
 * Calculates the average daily token consumption.
 */
export function calculateDailyAverageTokens(totalTokens: number, daysCount: number): number {
  if (!Number.isFinite(totalTokens) || !Number.isFinite(daysCount) || daysCount <= 0) {
    return 0;
  }
  return Math.round(Math.max(0, totalTokens) / daysCount);
}
