/**
 * Shared statistical primitives — the single implementation behind every
 * published number. Everything here is degenerate-safe (n=0/1, constants,
 * outliers) and documents its own semantics. Display-rounding belongs to the
 * call sites, never to these helpers.
 */

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Float median — null on empty. Never rounds; the display layer decides. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Population standard deviation (÷n) — the right choice only when the values ARE the whole population. */
export function populationStd(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

/**
 * Sample standard deviation (÷n−1) — unbiased for baselines estimated FROM a
 * sample. Detectors comparing "today vs a baseline of past days" must use this
 * one: with the 3-sample weekday baselines in anomaly detection, ÷n
 * underestimates σ by √(n/(n−1)) ≈ 1.22×, which was enough to manufacture
 * z≥2 "spikes" out of ordinary noise. n<2 → 0 (no information about spread).
 */
export function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

/** Median absolute deviation — robust spread for outlier-prone series. */
export function mad(values: number[]): number | null {
  const med = median(values);
  if (med === null) return null;
  return median(values.map((v) => Math.abs(v - med)));
}

/** Min-max scale to [0,1]; constant input → 0.5 (no information). */
export function minMax(v: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return (v - min) / (max - min);
}

/**
 * Robust scale to [0,1] anchored at the cohort median with MAD as the unit of
 * spread: 0.5 = typical, 0/1 = 3+ robust-σ below/above. Unlike min-max, one
 * outlier (a free SKU's cost-efficiency, a viral day) cannot compress the
 * rest of the cohort toward 0 — and unlike cohort min-max, the mapping is
 * stable enough across days to store as a chartable series.
 */
export function robustScale(v: number, cohort: number[]): number {
  const med = median(cohort);
  if (med === null) return 0.5;
  const spread = mad(cohort);
  if (spread === null || spread < 1e-9) return 0.5;
  const z = (v - med) / spread;
  // squash to [0,1] with a smooth tanh-style map: ±3 MADs ≈ ±0.46 from center
  return clamp(0.5 + 0.5 * Math.tanh(z / 3), 0, 1);
}

/**
 * Add-k smoothed ratio: (num+k)/(den+k). Kills the prev=1 → "4× surge" noise
 * without hiding real moves — as num,den → ∞ it converges to the raw ratio.
 */
export function shrinkRatio(num: number, den: number, k = 2): number {
  return (num + k) / (den + k);
}

/** Poisson z: how surprising is `value` against an expected count of `mean`. */
export function poissonZ(value: number, meanValue: number): number {
  if (meanValue <= 0) return value > 0 ? 3 : 0;
  return (value - meanValue) / Math.sqrt(meanValue);
}

/**
 * Is |r| surprising given n points and `comparisons` hypotheses tested?
 * Fisher z transform with a Bonferroni-adjusted bar: the per-comparison 5%
 * two-sided critical value is scaled by √(ln(comparisons)/ln(2)) ≈ wider bar
 * for each extra hypothesis — the "best of 11 lags" case needs r far above
 * the naive r≥0.4 to mean anything on ~20 points.
 */
export function correlationSignificant(r: number, n: number, comparisons: number): boolean {
  if (n < 4 || comparisons < 1) return false;
  const fisherZ = 0.5 * Math.log((1 + Math.min(0.9999, Math.abs(r))) / (1 - Math.min(0.9999, Math.abs(r))));
  const se = 1 / Math.sqrt(n - 3);
  const penalty = comparisons > 1 ? Math.sqrt(Math.log(comparisons) / Math.log(2)) : 1;
  return fisherZ / se > 1.96 * penalty;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function roundTo(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
