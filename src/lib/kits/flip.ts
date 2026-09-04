/**
 * Why did a pick change? Three answers, and only one of them is a miss.
 *
 *   upgrade    — something genuinely new appeared. The old call was right when
 *                it was made. Not a miss.
 *   drift      — the VENDOR moved underneath us: the tool was deprecated,
 *                discontinued, acquired, relicensed, or the vendor changed its
 *                pricing. Outside our judgement. Not a miss.
 *   correction — a better option was already available and we did not pick it.
 *                This is the miss, and the only number worth apologising for.
 *   unknown    — no prior history row exists for the cell, so there is no
 *                call to grade the flip against. Excluded from EVERY
 *                denominator: grading it as an upgrade (the old behaviour)
 *                inflated "upgrade" and deflated the published correction
 *                rate exactly on young cells.
 *
 * Collapsing these into one "how often were you wrong" figure would make a fast
 * field look like incompetence and create pressure to stop publishing it.
 */

export type ChangeKind = 'upgrade' | 'drift' | 'correction' | 'unknown' | 'unclassified';

/**
 * Vendor-side events only: the tool died or the vendor moved its own terms.
 * Bare mentions of cost/price are deliberately NOT here — "we picked the
 * overpriced tool and a cheaper one existed" is a correction, not drift, and
 * the old /pric|cost/ pattern hid exactly those misses in the drift bucket.
 */
const DRIFT_PATTERN =
  /deprecat|discontinu|shut ?down|sunset|end.?of.?life|acquir|went proprietary|licen[cs]e (change|switch)|policy change|rate.?limit|vendor (raised|hiked|increased|changed) pric|pricing (change|overhaul|increase)/i;

/**
 * The reason itself admits a then-available option was better. Checked BEFORE
 * drift: a reason mentioning both ("great tool but we missed that X was
 * cheaper") is a correction — the miss we publish — not a price event.
 */
const CORRECTION_PATTERN =
  /missed|overlook|cheaper|better (option|alternative|choice)|already (existed|available)|should (have|'ve) (picked|chosen|used)/i;

export interface FlipInput {
  /** The reason recorded on the kit_pick_history row. */
  reason: string;
  /** Previous pick; null means this cell had no pick before. */
  fromPick: string | null;
  /** Days the previous pick stood, null when there is no prior history row. */
  heldDays: number | null;
  /** Was the replacement already observable when the original call was made? */
  replacementExistedAtCall: boolean;
}

export function classifyFlip(input: FlipInput): { kind: ChangeKind; why: string } {
  if (input.fromPick === null) {
    return { kind: 'unclassified', why: 'first pick for this cell — nothing to grade against' };
  }
  if (input.heldDays === null) {
    return {
      kind: 'unknown',
      why: 'no prior history row for this cell — the original call is undatable, so the flip cannot be graded',
    };
  }
  if (input.replacementExistedAtCall && CORRECTION_PATTERN.test(input.reason)) {
    return { kind: 'correction', why: 'the reason admits a then-available option was better — correction wins over drift' };
  }
  if (DRIFT_PATTERN.test(input.reason)) {
    return { kind: 'drift', why: 'a vendor-side event (deprecation, shutdown, licence or vendor price move) forced the change' };
  }
  if (!input.replacementExistedAtCall) {
    return { kind: 'upgrade', why: 'the replacement did not exist at call time — the original call stood on what was available' };
  }
  return { kind: 'correction', why: 'the replacement was available at call time and was not picked' };
}
