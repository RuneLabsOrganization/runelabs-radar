/**
 * The verdict-side companion to accuracy.ts.
 *
 * accuracy.ts answers "did the news we scored highly turn out to matter".
 * This answers the question the product actually stakes its name on: "when we
 * said use X, was that right, and how long did it stay right".
 *
 * Everything here is zero-safe and reports its own denominator, because these
 * numbers get published and a rate without an n is a claim without evidence.
 */
import { isNull, ne } from 'drizzle-orm';
import { getDb } from '../db';
import { kitPickHistory, verdictClaims } from '../db/schema';
import { UNREGISTERED } from '../kits/claims';

/** heldDays sentinel written by the grader when the span is unknowable. */
const UNKNOWN_HELD = -1;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function gradedFlips() {
  return getDb()
    .select()
    .from(kitPickHistory)
    .where(ne(kitPickHistory.changeKind, 'unclassified'))
    .all();
}

/** Median days a pick stands before it is replaced. The field's clock speed. */
export function pickHalfLife(): number | null {
  const held = gradedFlips()
    .map((r) => r.heldDays)
    .filter((d): d is number => d !== null && d !== UNKNOWN_HELD);
  return median(held);
}

/** How often we were actually wrong, as opposed to overtaken. */
export function correctionRate(): { corrections: number; graded: number; pct: number } {
  const flips = gradedFlips();
  const corrections = flips.filter((r) => r.changeKind === 'correction').length;
  return {
    corrections,
    graded: flips.length,
    pct: flips.length === 0 ? 0 : Math.round((corrections / flips.length) * 100),
  };
}

/**
 * Cells that went A → B → A. A reversal means the original call was noise:
 * we changed our mind and then changed it back.
 */
export function reversalRate(): { reversed: number; cells: number; pct: number } {
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
  return { reversed, cells, pct: cells === 0 ? 0 : Math.round((reversed / cells) * 100) };
}

/**
 * What share of live verdicts state what would disprove them. Published
 * deliberately: an unregistered claim is a call we cannot grade, and hiding
 * that would make every other number on the page look better than it is.
 */
export function falsifierCoverage(): { registered: number; open: number; pct: number } {
  const open = getDb().select().from(verdictClaims).where(isNull(verdictClaims.closedAt)).all();
  const registered = open.filter((c) => c.falsifier !== UNREGISTERED).length;
  return {
    registered,
    open: open.length,
    pct: open.length === 0 ? 0 : Math.round((registered / open.length) * 100),
  };
}

export interface VerdictSummary {
  halfLifeDays: number | null;
  correction: ReturnType<typeof correctionRate>;
  reversal: ReturnType<typeof reversalRate>;
  coverage: ReturnType<typeof falsifierCoverage>;
}

/** One call for the trust page — four numbers, each with its denominator. */
export function verdictSummary(): VerdictSummary {
  return {
    halfLifeDays: pickHalfLife(),
    correction: correctionRate(),
    reversal: reversalRate(),
    coverage: falsifierCoverage(),
  };
}
