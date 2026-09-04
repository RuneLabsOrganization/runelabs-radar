// Pure math for the science layer — no DB, no LLM, fully deterministic
// (seeded RNG) so runs are reproducible and testable.

import { mean, populationStd, sampleStd } from '../stats';

/** Deterministic LCG — Math.random is banned here for reproducibility. */
export function makeRng(seed = 1337): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function dist2(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const t = a[i] - b[i];
    d += t * t;
  }
  return d;
}

export interface KmeansResult {
  assignments: number[];
  centroids: Float32Array[];
}

/**
 * k-means with k-means++ seeding, seeded RNG, fixed iteration cap.
 * Empty clusters are re-seeded from the farthest point.
 */
export function kmeans(vectors: Float32Array[], k: number, seed = 1337, maxIter = 50): KmeansResult {
  const n = vectors.length;
  if (n === 0 || k <= 0) return { assignments: [], centroids: [] };
  const kk = Math.min(k, n);
  const rng = makeRng(seed);
  const dim = vectors[0].length;

  // k-means++ init
  const centroids: Float32Array[] = [new Float32Array(vectors[Math.floor(rng() * n)])];
  const minD = new Array<number>(n).fill(Infinity);
  while (centroids.length < kk) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      minD[i] = Math.min(minD[i], dist2(vectors[i], centroids[centroids.length - 1]));
      sum += minD[i];
    }
    let target = rng() * sum;
    let picked = n - 1;
    for (let i = 0; i < n; i++) {
      target -= minD[i];
      if (target <= 0) {
        picked = i;
        break;
      }
    }
    centroids.push(new Float32Array(vectors[picked]));
  }

  const assignments = new Array<number>(n).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const d = dist2(vectors[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }
    // recompute centroids
    const sums = Array.from({ length: kk }, () => new Float64Array(dim));
    const counts = new Array<number>(kk).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < dim; d++) sums[c][d] += vectors[i][d];
    }
    for (let c = 0; c < kk; c++) {
      if (counts[c] === 0) {
        // re-seed empty cluster from the point farthest from its centroid
        let far = 0;
        let farD = -1;
        for (let i = 0; i < n; i++) {
          const d = dist2(vectors[i], centroids[assignments[i]]);
          if (d > farD) {
            farD = d;
            far = i;
          }
        }
        centroids[c] = new Float32Array(vectors[far]);
        continue;
      }
      const next = new Float32Array(dim);
      for (let d = 0; d < dim; d++) next[d] = sums[c][d] / counts[c];
      centroids[c] = next;
    }
    if (!changed) break;
  }
  return { assignments, centroids };
}

/**
 * Top-2 principal components via power iteration with deflation.
 * Returns per-vector 2D coordinates, centered, roughly unit-scaled.
 */
export function pca2d(vectors: Float32Array[], seed = 7, iterations = 60): { x: number; y: number }[] {
  const n = vectors.length;
  if (n === 0) return [];
  const dim = vectors[0].length;
  if (n === 1) return [{ x: 0, y: 0 }];

  // center
  const mean = new Float64Array(dim);
  for (const v of vectors) for (let d = 0; d < dim; d++) mean[d] += v[d];
  for (let d = 0; d < dim; d++) mean[d] /= n;
  const X = vectors.map((v) => {
    const c = new Float64Array(dim);
    for (let d = 0; d < dim; d++) c[d] = v[d] - mean[d];
    return c;
  });

  const rng = makeRng(seed);
  const powerComponent = (deflate: Float64Array | null): Float64Array => {
    let v = new Float64Array(dim);
    for (let d = 0; d < dim; d++) v[d] = rng() - 0.5;
    for (let it = 0; it < iterations; it++) {
      // w = X^T (X v) — covariance-vector product without forming the matrix
      const scores = X.map((row) => {
        let s = 0;
        for (let d = 0; d < dim; d++) s += row[d] * v[d];
        return s;
      });
      const w = new Float64Array(dim);
      for (let i = 0; i < n; i++) {
        for (let d = 0; d < dim; d++) w[d] += X[i][d] * scores[i];
      }
      if (deflate) {
        let proj = 0;
        for (let d = 0; d < dim; d++) proj += w[d] * deflate[d];
        for (let d = 0; d < dim; d++) w[d] -= proj * deflate[d];
      }
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += w[d] * w[d];
      norm = Math.sqrt(norm) || 1;
      for (let d = 0; d < dim; d++) w[d] /= norm;
      v = w;
    }
    return v;
  };

  const pc1 = powerComponent(null);
  const pc2 = powerComponent(pc1);

  const coords = X.map((row) => {
    let x = 0;
    let y = 0;
    for (let d = 0; d < dim; d++) {
      x += row[d] * pc1[d];
      y += row[d] * pc2[d];
    }
    return { x, y };
  });
  // normalize to unit-ish spread so consumers can scale freely
  const spread = Math.max(1e-9, ...coords.map((c) => Math.max(Math.abs(c.x), Math.abs(c.y))));
  return coords.map((c) => ({ x: c.x / spread, y: c.y / spread }));
}

/** Mean and population standard deviation. For a baseline SAMPLED from past
 *  days, use zScore — it switches to sample std (n−1) below 30 points. */
export function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  return { mean: mean(values), std: populationStd(values) };
}

/**
 * z-score of value against a baseline.
 *
 * Small baselines (<30 points) are scored with the SAMPLE std (n−1): ÷n on a
 * 3-sample baseline underestimates σ by ~1.22×, which manufactured z≥2
 * "spikes" out of ordinary noise.
 *
 * Degenerate baseline (stdev 0 — a flat rate): ANY uptick would otherwise read
 * as "3σ", so a flat 2-stories/day sector hitting 3 was published as a spike.
 * A constant rate is Poisson-like: a genuine jump needs real volume (mean ≥ 5)
 * and at least a doubling, scored against Poisson noise (σ = √mean). Anything
 * smaller on a flat baseline is indistinguishable from jitter → 0.
 */
export function zScore(value: number, baseline: number[]): number {
  if (baseline.length === 0) return 0;
  const m = mean(baseline);
  const std = baseline.length < 30 ? sampleStd(baseline) : populationStd(baseline);
  if (std < 1e-9) {
    if (value <= m || m < 5 || value < 2 * m) return 0;
    return (value - m) / Math.sqrt(m);
  }
  return (value - m) / std;
}

/**
 * The publish bar for a z-score. A fixed z≥2 is overconfident on tiny
 * baselines (the std itself is estimated from n points), so the bar widens
 * for small n: z ≥ 2·(1+1/n).
 */
export function zGate(baselinePoints: number): number {
  return 2 * (1 + 1 / Math.max(1, baselinePoints));
}

export interface Fit {
  slope: number;
  intercept: number;
  r2: number;
  residualStd: number;
}

/** Ordinary least squares y = slope·x + intercept. */
export function linearFit(points: { x: number; y: number }[]): Fit | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  if (sxx < 1e-12) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    ssRes += (p.y - (slope * p.x + intercept)) ** 2;
    ssTot += (p.y - my) ** 2;
  }
  return {
    slope,
    intercept,
    // constant series (ssTot≈0): the fit explains NOTHING about variance that
    // isn't there — r2 = 1 claimed "perfect fit" and downstream projected with
    // a near-zero band. 0 is the honest "no explanatory power".
    r2: ssTot < 1e-12 ? 0 : 1 - ssRes / ssTot,
    residualStd: Math.sqrt(ssRes / Math.max(1, n - 2)),
  };
}

export interface CrossCorrelation {
  lag: number;
  coefficient: number;
  /** paired points behind the coefficient — identical across lags, so the
   *  coefficients are comparable (a shrinking per-lag window made larger lags
   *  noisier and their |r| artificially bigger) */
  n: number;
}

/** A lag coefficient on fewer paired points than this is not publishable. */
export const CROSS_CORRELATE_MIN_OVERLAP = 14;

/**
 * Normalized cross-correlation of two equal-length series at lags 0..maxLag
 * (b shifted later than a — "a leads b by lag"). Returns the best |r|.
 *
 * Every lag is scored on the SAME fixed window of a[0 .. n−maxLag) against a
 * shifted b — coefficients across lags are comparable and each carries n =
 * window paired points. Callers pair series by inner-joining real dates (no
 * zero-fill) and gate publication with correlationSignificant from lib/stats.
 */
export function crossCorrelate(
  a: number[],
  b: number[],
  maxLag: number,
  minOverlap: number = CROSS_CORRELATE_MIN_OVERLAP,
): CrossCorrelation | null {
  const len = Math.min(a.length, b.length);
  const window = len - maxLag;
  if (window < minOverlap) return null;
  const xs = a.slice(0, window);
  const { mean: mxv, std: sx } = meanStd(xs);
  if (sx < 1e-9) return null;
  let best: CrossCorrelation | null = null;
  for (let lag = 0; lag <= maxLag; lag++) {
    const ys = b.slice(lag, lag + window);
    const { mean: myv, std: sy } = meanStd(ys);
    if (sy < 1e-9) continue;
    let cov = 0;
    for (let i = 0; i < window; i++) cov += (xs[i] - mxv) * (ys[i] - myv);
    cov /= window;
    const r = cov / (sx * sy);
    if (!best || Math.abs(r) > Math.abs(best.coefficient)) best = { lag, coefficient: r, n: window };
  }
  return best;
}
