/**
 * Performance Telemetry Benchmark Statistics Suite.
 *
 * Provides rigorous statistical calculation (mean, percentiles p50..p99, IQR outlier filtering,
 * moving averages, and histogram binning) for host and task performance telemetry.
 *
 * @module telemetryBenchmark
 */

export interface TelemetrySummaryStats {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly median: number;
  readonly variance: number;
  readonly stdDev: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
}

export interface HistogramBin {
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly count: number;
  readonly percentage: number;
}

/**
 * Calculates complete distribution summary statistics from a sample array.
 */
export function calculateTelemetryStats(samples: readonly number[]): TelemetrySummaryStats {
  const valid = samples.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const count = valid.length;

  if (count === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      variance: 0,
      stdDev: 0,
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
    };
  }

  const min = valid[0]!;
  const max = valid[count - 1]!;
  const sum = valid.reduce((acc, val) => acc + val, 0);
  const mean = sum / count;

  const variance = valid.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
  const stdDev = Math.sqrt(variance);

  return {
    count,
    min: round(min),
    max: round(max),
    mean: round(mean),
    median: round(calculatePercentile(valid, 50)),
    variance: round(variance),
    stdDev: round(stdDev),
    p50: round(calculatePercentile(valid, 50)),
    p75: round(calculatePercentile(valid, 75)),
    p90: round(calculatePercentile(valid, 90)),
    p95: round(calculatePercentile(valid, 95)),
    p99: round(calculatePercentile(valid, 99)),
  };
}

/**
 * Computes an exact or linearly-interpolated percentile (0..100) from pre-sorted samples.
 */
export function calculatePercentile(sorted: readonly number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;

  const p = Math.max(0, Math.min(100, percentile));
  const rank = (p / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const weight = rank - lowerIndex;

  const lowerVal = sorted[lowerIndex]!;
  const upperVal = sorted[upperIndex]!;

  return lowerVal + weight * (upperVal - lowerVal);
}

/**
 * Filters out extreme outliers using the 1.5 * IQR (Interquartile Range) method.
 */
export function filterIqrOutliers(samples: readonly number[]): readonly number[] {
  const valid = samples.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (valid.length < 4) return valid;

  const q1 = calculatePercentile(valid, 25);
  const q3 = calculatePercentile(valid, 75);
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  return valid.filter((val) => val >= lowerBound && val <= upperBound);
}

/**
 * Computes an Exponential Moving Average (EMA) series across ordered samples.
 */
export function computeEma(samples: readonly number[], smoothingAlpha = 0.2): readonly number[] {
  if (samples.length === 0) return [];
  const alpha = Math.max(0.01, Math.min(1, smoothingAlpha));

  const result: number[] = [];
  let currentEma = samples[0]!;
  result.push(round(currentEma));

  for (let i = 1; i < samples.length; i++) {
    const val = samples[i]!;
    currentEma = alpha * val + (1 - alpha) * currentEma;
    result.push(round(currentEma));
  }

  return result;
}

/**
 * Generates uniform histogram buckets across sample range.
 */
export function generateHistogramBins(
  samples: readonly number[],
  binCount = 5,
): readonly HistogramBin[] {
  const valid = samples.filter((n) => Number.isFinite(n));
  if (valid.length === 0 || binCount <= 0) return [];

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (min === max) {
    return [
      {
        lowerBound: min,
        upperBound: max,
        count: valid.length,
        percentage: 100,
      },
    ];
  }

  const range = max - min;
  const step = range / binCount;
  const bins: { lowerBound: number; upperBound: number; count: number }[] = [];

  for (let i = 0; i < binCount; i++) {
    bins.push({
      lowerBound: round(min + i * step),
      upperBound: round(i === binCount - 1 ? max : min + (i + 1) * step),
      count: 0,
    });
  }

  for (const val of valid) {
    const binIndex = Math.min(binCount - 1, Math.floor((val - min) / step));
    if (bins[binIndex]) {
      bins[binIndex].count += 1;
    }
  }

  return bins.map((bin) => ({
    ...bin,
    percentage: round((bin.count / valid.length) * 100),
  }));
}

function round(n: number): number {
  return Number(n.toFixed(4));
}
