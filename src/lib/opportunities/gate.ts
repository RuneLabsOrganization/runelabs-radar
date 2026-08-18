// Client-safe module: the deterministic scoring gate + review-trail types.
// No DB/LLM imports — pure functions, exhaustively unit-tested.

import { compositeScore, FLIP_WEIGHTS, HOLD_WEIGHTS, type SubKey, type SubScores } from './axes';

export type Verdict = 'pursue' | 'watch' | 'reject';

export interface AxisAdjustment {
  axis: SubKey;
  /** clamped −6..+6 by the critic sanitizer */
  delta: number;
  reason: string;
}

/** What the adversarial critic returned for one proposal (post-sanitizer). */
export interface CriticResult {
  slug: string;
  verdict: Verdict;
  confidence: number;
  killRisks: string[];
  adjustments: AxisAdjustment[];
  flags: string[];
  /** critic call failed or omitted this slug — absence of review is never "strong" */
  unavailable?: boolean;
}

export interface GateKpis {
  initialCostUsd: number | null;
  monthlyCostUsd: number | null;
  priceUsd: number | null;
  breakEvenCustomers: number | null;
  competitorCount: number | null;
}

export interface GateInput {
  sub: SubScores;
  kpis: GateKpis | null;
  windowMonths: number | null;
  evidenceCount: number;
  legacy: boolean;
}

export interface CapNote {
  play: 'flip' | 'hold';
  rule: string;
  from: number;
  to: number;
}

/** The auditable trail: raw LLM numbers → adjustments → caps → final verdict. */
export interface ReviewTrail {
  killRisks: string[];
  adjustments: AxisAdjustment[];
  flags: string[];
  capsApplied: CapNote[];
  criticVerdict: Verdict;
  /** composites of the proposer's ORIGINAL sub-scores, before any review */
  rawFlip: number;
  rawHold: number;
  criticUnavailable?: boolean;
}

export interface GateOutput {
  flipScore: number;
  holdScore: number;
  verdict: Verdict;
  confidence: number;
  review: ReviewTrail;
}

const clamp20 = (v: number): number => Math.max(0, Math.min(20, Math.round(v)));
const VERDICT_RANK: Record<Verdict, number> = { reject: 0, watch: 1, pursue: 2 };

/**
 * "3-4 months before saturation" → 3 (the pessimistic low end — a rocksolid
 * gate prices the risk arriving early, not late). Handles weeks/years.
 * Returns null when no duration is stated.
 */
export function parseWindowMonths(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s*(?:[-–]\s*\d+)?\s*(years?|yrs?|months?|mos?|weeks?|wks?)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const months = unit.startsWith('y') ? n * 12 : unit.startsWith('w') ? Math.round(n / 4.33) : n;
  return months > 0 && months <= 120 ? months : null;
}

/** Refresh hysteresis: 70% new + 30% prior — kills day-to-day score oscillation. */
export function blendScore(current: number, prior: number | null): number {
  return prior === null ? current : Math.round(current * 0.7 + prior * 0.3);
}

/** Fallback when the critic can't review a proposal — unverified is never "strong". */
export function unverifiedCritic(slug: string): CriticResult {
  return {
    slug,
    verdict: 'watch',
    confidence: 40,
    killRisks: [],
    adjustments: [],
    flags: ['critic unavailable — unverified'],
    unavailable: true,
  };
}

/**
 * The gate: critic adjustments → coherence forcing → composites → hard caps →
 * verdict. Every mutation is recorded in the returned trail — the number a user
 * sees is always explainable line by line.
 */
export function applyGate(input: GateInput, critic: CriticResult): GateOutput {
  const rawFlip = compositeScore(input.sub, FLIP_WEIGHTS);
  const rawHold = compositeScore(input.sub, HOLD_WEIGHTS);

  // R10: legacy rows predate the 10-axis dossier — no gate, no pretend-review
  if (input.legacy) {
    return {
      flipScore: rawFlip,
      holdScore: rawHold,
      verdict: 'watch',
      confidence: 40,
      review: {
        killRisks: [],
        adjustments: [],
        flags: ['legacy-row'],
        capsApplied: [],
        criticVerdict: 'watch',
        rawFlip,
        rawHold,
        criticUnavailable: critic.unavailable,
      },
    };
  }

  // 1. critic axis adjustments, clamped into 0..20
  const adjusted = { ...input.sub };
  const appliedAdj: AxisAdjustment[] = [];
  for (const a of critic.adjustments) {
    if (a.delta === 0) continue;
    const next = clamp20(adjusted[a.axis] + a.delta);
    if (next === adjusted[a.axis]) continue;
    appliedAdj.push({ axis: a.axis, delta: next - adjusted[a.axis], reason: a.reason });
    adjusted[a.axis] = next;
  }

  const flags = [...critic.flags];

  // R7: "wide-open field" contradicted by named competitors — force coherence
  const comp = input.kpis?.competitorCount ?? null;
  if (comp !== null && comp >= 5 && adjusted.competition >= 15) {
    flags.push(`competition ${adjusted.competition}/20 contradicted by ${comp} named competitors`);
    adjusted.competition = 12;
  }

  let flip = compositeScore(adjusted, FLIP_WEIGHTS);
  let hold = compositeScore(adjusted, HOLD_WEIGHTS);

  const capsApplied: CapNote[] = [];
  const cap = (play: 'flip' | 'hold' | 'both', rule: string, max: number) => {
    if (play !== 'hold' && flip > max) {
      capsApplied.push({ play: 'flip', rule, from: flip, to: max });
      flip = max;
    }
    if (play !== 'flip' && hold > max) {
      capsApplied.push({ play: 'hold', rule, from: hold, to: max });
      hold = max;
    }
  };

  // R1-R4: the window is a hard input, not free text — a hold must outlive its window
  const w = input.windowMonths;
  const r1 = w !== null && w <= 2;
  if (r1) {
    cap('flip', 'window ≤ 2mo', 40);
    cap('hold', 'window ≤ 2mo', 30);
  } else if (w !== null && w <= 4) cap('hold', 'window ≤ 4mo', 45);
  else if (w !== null && w <= 6) cap('hold', 'window ≤ 6mo', 55);
  else if (w !== null && w <= 9) cap('hold', 'window ≤ 9mo', 65);

  // R5-R6: no defensibility, no MRR story
  if (adjusted.moat <= 5) cap('hold', 'moat ≤ 5', 50);
  else if (adjusted.moat <= 8) cap('hold', 'moat ≤ 8', 60);

  // R8: the economics must close inside the window at the stated break-even scale
  const be = input.kpis?.breakEvenCustomers ?? null;
  const price = input.kpis?.priceUsd ?? null;
  const run = input.kpis?.monthlyCostUsd ?? null;
  const init = input.kpis?.initialCostUsd ?? null;
  if (be !== null && price !== null && run !== null && init !== null && w !== null) {
    const monthlyProfit = be * price - run;
    if (monthlyProfit <= 0) {
      flags.push('never breaks even at stated economics');
      cap('both', 'economics don’t close', 50);
    } else {
      const paybackMonths = init / monthlyProfit;
      if (paybackMonths > w) {
        flags.push(`payback ~${Math.ceil(paybackMonths)}mo exceeds window ${w}mo`);
        cap('both', 'economics don’t close', 50);
      }
    }
  }

  // R9: evidence floor — confidence follows citation depth
  let confidence = Math.max(0, Math.min(100, Math.round(critic.confidence)));
  if (input.evidenceCount === 0) {
    confidence = Math.min(confidence, 30);
    flags.push('no cited evidence');
  } else if (input.evidenceCount === 1) {
    confidence = Math.min(confidence, 50);
    flags.push('single-source evidence');
  }

  // verdict: critic's call, hardened by the gate
  let verdict = critic.verdict;
  if (critic.verdict === 'reject' || r1 || confidence < 30) {
    verdict = 'reject';
  } else if ((flags.length > 0 || capsApplied.length > 0) && VERDICT_RANK[verdict] > VERDICT_RANK.watch) {
    verdict = 'watch';
  }

  return {
    flipScore: flip,
    holdScore: hold,
    verdict,
    confidence,
    review: {
      killRisks: critic.killRisks,
      adjustments: appliedAdj,
      flags,
      capsApplied,
      criticVerdict: critic.verdict,
      rawFlip,
      rawHold,
      criticUnavailable: critic.unavailable,
    },
  };
}
