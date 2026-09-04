// Client-safe module: assessment axes + score math, no DB/LLM imports
// (OpportunityList renders in the browser).

/** Simply-Wall-St rule: the fill COLOR is the verdict; the shape is the detail. */
export function gradeColor(score: number): string {
  return score >= 70 ? 'var(--phosphor)' : score >= 45 ? 'var(--amber)' : 'var(--alert)';
}

/** One-word verdict band, same cutoffs as gradeColor — anchors a bare number. */
export function gradeBand(score: number): string {
  return score >= 70 ? 'strong' : score >= 45 ? 'fair' : 'weak';
}

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

/**
 * 0-20 sub-scores → 0-100 composite under the given weights. Deterministic and
 * explainable. An axis missing from a partial payload contributes 0 — that is
 * a deliberate degradation, and callers MUST surface it (applyGate records
 * `missingAxes` in the review trail and caps confidence when >2 are missing);
 * never let a partial payload read as a plain "terrible" score silently.
 */
export function compositeScore(sub: SubScores, weights: SubScores): number {
  let s = 0;
  for (const k of SUB_KEYS) s += weights[k] * (sub[k] ?? 0);
  return Math.round(s * 5);
}

/**
 * The ONE per-axis sanitize every sub-score parser shares: finite numbers
 * clamp into 0..20 (rounded by default — the stored form is integer), numeric
 * strings coerce (models emit "15" often enough), anything else → null.
 */
export function coerceSubScore(v: unknown, opts?: { round?: boolean }): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(20, n));
  return opts?.round === false ? clamped : Math.round(clamped);
}

export interface ParsedSubScores {
  sub: SubScores;
  /** Corrupt JSON or a pre-dossier row (no numeric moat) — R10 keeps these ungated. */
  legacy: boolean;
  /** Axes absent or non-numeric in the payload; zero-filled in `sub`. */
  missing: SubKey[];
}

/**
 * The ONE parser for a stored `scores` JSON blob. forge, rescore and view used
 * to carry three divergent copies (clamp vs clamp+round vs passthrough), so
 * the same row scored differently depending on which surface touched it, and
 * corrupt JSON silently became all-zeros with no legacy flag on some paths.
 * Now: clamp 0..20, non-finite → 0 + recorded in `missing`, corrupt or
 * pre-dossier → zeros + legacy.
 */
export function parseSubScores(json: string, opts?: { round?: boolean }): ParsedSubScores {
  let parsed: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(json);
    if (typeof v === 'object' && v !== null) parsed = v as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const zero = Object.fromEntries(SUB_KEYS.map((k) => [k, 0])) as SubScores;
  if (parsed === null) {
    return { sub: zero, legacy: true, missing: [...SUB_KEYS] };
  }
  const missing: SubKey[] = [];
  for (const k of SUB_KEYS) {
    const v = coerceSubScore(parsed[k], opts);
    if (v === null) missing.push(k);
    else zero[k] = v;
  }
  // R10: rows pre-dating the 10-axis dossier stay legacy (never gated) — but
  // the axes they DO carry still read, on every surface
  return { sub: zero, legacy: typeof parsed.moat !== 'number', missing };
}
