/**
 * The verdict-side companion to accuracy.ts.
 *
 * accuracy.ts answers "did the news we scored highly turn out to matter".
 * This answers the question the product actually stakes its name on: "when we
 * said use X, was that right, and how long did it stay right".
 *
 * Everything here is zero-safe and reports its own denominator, because these
 * numbers get published and a rate without an n is a claim without evidence.
 * A rate with n=0 reports pct null — "0% of nothing" reads as a perfect
 * record, and the page renders "—" instead.
 */
import { isNull, ne } from 'drizzle-orm';
import { getDb } from '../db';
import { kitPickHistory, verdictClaims } from '../db/schema';
import { UNREGISTERED } from '../kits/claims';
import { median } from '../stats';

/** heldDays sentinel written by the grader when the span is unknowable. */
const UNKNOWN_HELD = -1;

const DAY_MS = 86_400_000;

/** Horizon for the "still standing" survival figure. */
export const STANDING_HORIZON_DAYS = 30;

/** Display-level integer median over whole-day spans (float median lives in stats). */
function medianInt(values: number[]): number | null {
  const m = median(values);
  return m === null ? null : Math.round(m);
}

function gradedFlips() {
  return getDb()
    .select()
    .from(kitPickHistory)
    .where(ne(kitPickHistory.changeKind, 'unclassified'))
    .all();
}

export interface PickLongevity {
  /**
   * Median days a pick stood before replacement — CLOSED flips only. This is
   * right-censored: picks still standing (the longest-lived, i.e. the best
   * calls) are excluded, so on its own it UNDERSTATES longevity and gets
   * worse exactly when the calls are good. Never publish it without
   * standingPct beside it.
   */
  medianHeldDays: number | null;
  /** n behind medianHeldDays. */
  closedFlips: number;
  /** % of currently-standing picks with a datable start at least STANDING_HORIZON_DAYS old. Null when n=0. */
  standingPct: number | null;
  /** n behind standingPct: standing picks whose start we can date. */
  standingDatable: number;
  /** Of those, how many have stood ≥ the horizon. */
  stillStanding: number;
  horizonDays: number;
}

/**
 * How long picks live — two numbers, because a closed-only median lies by
 * omission. The survival half is computed from each cell's latest history
 * row: the current pick began standing at the last recorded change.
 */
export function pickLongevity(): PickLongevity {
  const db = getDb();
  const held = gradedFlips()
    .map((r) => r.heldDays)
    .filter((d): d is number => d !== null && d !== UNKNOWN_HELD);

  const rows = db
    .select({
      category: kitPickHistory.category,
      task: kitPickHistory.task,
      tier: kitPickHistory.tier,
      changedAt: kitPickHistory.changedAt,
    })
    .from(kitPickHistory)
    .all();
  const latestByCell = new Map<string, Date>();
  for (const r of rows) {
    const key = `${r.category}/${r.task}/${r.tier}`;
    const cur = latestByCell.get(key);
    if (!cur || r.changedAt > cur) latestByCell.set(key, r.changedAt);
  }
  const now = Date.now();
  let stillStanding = 0;
  for (const started of latestByCell.values()) {
    if ((now - started.getTime()) / DAY_MS >= STANDING_HORIZON_DAYS) stillStanding += 1;
  }
  const standingDatable = latestByCell.size;

  return {
    medianHeldDays: medianInt(held),
    closedFlips: held.length,
    standingPct: standingDatable === 0 ? null : Math.round((stillStanding / standingDatable) * 100),
    standingDatable,
    stillStanding,
    horizonDays: STANDING_HORIZON_DAYS,
  };
}

/** How often we were actually wrong, as opposed to overtaken. */
export function correctionRate(): { corrections: number; graded: number; pct: number | null } {
  const flips = gradedFlips();
  const corrections = flips.filter((r) => r.changeKind === 'correction').length;
  return {
    corrections,
    graded: flips.length,
    pct: flips.length === 0 ? null : Math.round((corrections / flips.length) * 100),
  };
}

/**
 * Cells that went A → B → A. A reversal means the original call was noise:
 * we changed our mind and then changed it back.
 */
export function reversalRate(): { reversed: number; cells: number; pct: number | null } {
  const rows = getDb()
    .select()
    .from(kitPickHistory)
    .orderBy(kitPickHistory.changedAt)
    .all();

  const byCell = new Map<string, string[]>();
  for (const r of rows) {
    const key = `${r.category}/${r.task}/${r.tier}`;
    const seq = byCell.get(key) ?? [];
    // Seed the pick we left, otherwise A→B→A never sees A until it returns.
    if (seq.length === 0 && r.fromPick) seq.push(r.fromPick);
    seq.push(r.toPick);
    byCell.set(key, seq);
  }

  let reversed = 0;
  for (const seq of byCell.values()) {
    const seen = new Set<string>();
    let isReversal = false;
    for (const pick of seq) {
      if (seen.has(pick)) {
        // a pick we already moved away from has come back — not the first appearance
        isReversal = true;
        break;
      }
      seen.add(pick);
    }
    if (isReversal) reversed += 1;
  }

  const cells = byCell.size;
  return { reversed, cells, pct: cells === 0 ? null : Math.round((reversed / cells) * 100) };
}

/**
 * What share of live verdicts state what would disprove them. Published
 * deliberately: an unregistered claim is a call we cannot grade, and hiding
 * that would make every other number on the page look better than it is.
 */
export function falsifierCoverage(): { registered: number; open: number; pct: number | null } {
  const open = getDb().select().from(verdictClaims).where(isNull(verdictClaims.closedAt)).all();
  const registered = open.filter((c) => c.falsifier !== UNREGISTERED).length;
  return {
    registered,
    open: open.length,
    pct: open.length === 0 ? null : Math.round((registered / open.length) * 100),
  };
}

export interface VerdictSummary {
  longevity: PickLongevity;
  correction: ReturnType<typeof correctionRate>;
  reversal: ReturnType<typeof reversalRate>;
  coverage: ReturnType<typeof falsifierCoverage>;
}

/** One call for the trust page — four numbers, each with its denominator. */
export function verdictSummary(): VerdictSummary {
  return {
    longevity: pickLongevity(),
    correction: correctionRate(),
    reversal: reversalRate(),
    coverage: falsifierCoverage(),
  };
}
