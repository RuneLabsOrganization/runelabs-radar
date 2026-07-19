// Client-safe module: assessment axes + score math, no DB/LLM imports
// (OpportunityList renders in the browser).

export const SUB_KEYS = [
  'demand',
  'buildability',
  'margin',
  'competition', // 20 = wide-open field
  'timing',
  'moat', // defensibility once shipped
  'regClear', // 20 = no regulatory exposure
  'platformSafe', // 20 = no single-platform dependency
  'distribution', // 20 = ICP easy to reach
  'qualityBar', // 20 = sellable quality is easy to hit
] as const;
export type SubKey = (typeof SUB_KEYS)[number];
export type SubScores = Record<SubKey, number>;

/** Flip = sell fast: speed-to-ship, window and reach dominate. Weights sum to 1. */
export const FLIP_WEIGHTS: SubScores = {
  buildability: 0.22,
  timing: 0.18,
  demand: 0.14,
  distribution: 0.12,
  competition: 0.1,
  qualityBar: 0.08,
  margin: 0.06,
  platformSafe: 0.04,
  regClear: 0.04,
  moat: 0.02,
};

/** Hold = cash-flow portfolio: margin, durable demand and defensibility dominate. */
export const HOLD_WEIGHTS: SubScores = {
  margin: 0.2,
  demand: 0.18,
  moat: 0.14,
  competition: 0.1,
  distribution: 0.1,
  regClear: 0.08,
  platformSafe: 0.08,
  qualityBar: 0.06,
  buildability: 0.04,
  timing: 0.02,
};

/** 0-20 sub-scores → 0-100 composite under the given weights. Deterministic and explainable. */
export function compositeScore(sub: SubScores, weights: SubScores): number {
  let s = 0;
  for (const k of SUB_KEYS) s += weights[k] * (sub[k] ?? 0);
  return Math.round(s * 5);
}
