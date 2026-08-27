/**
 * Why did a pick change? Three answers, and only one of them is a miss.
 *
 *   upgrade    — something genuinely new appeared. The old call was right when
 *                it was made. Not a miss.
 *   drift      — price, licence or availability moved underneath us. Outside
 *                our judgement. Not a miss.
 *   correction — a better option was already available and we did not pick it.
 *                This is the miss, and the only number worth apologising for.
 *
 * Collapsing these into one "how often were you wrong" figure would make a fast
 * field look like incompetence and create pressure to stop publishing it.
 */

export type ChangeKind = 'upgrade' | 'drift' | 'correction' | 'unclassified';

/** Reasons that indicate the world moved, not that our judgement was wrong. */
const DRIFT_PATTERN = /pric|cost|deprecat|discontinu|shut ?down|sunset|licen[cs]|policy|acquir|rate.?limit/i;

export interface FlipInput {
  /** The reason recorded on the kit_pick_history row. */
  reason: string;
  /** Previous pick; null means this cell had no pick before. */
  fromPick: string | null;
  /** Days the previous pick stood, null when unknown. */
  heldDays: number | null;
  /** Was the replacement already observable when the original call was made? */
  replacementExistedAtCall: boolean;
}

export function classifyFlip(input: FlipInput): { kind: ChangeKind; why: string } {
  if (input.fromPick === null) {
    return { kind: 'unclassified', why: 'first pick for this cell — nothing to grade against' };
  }
  if (!input.replacementExistedAtCall) {
    return { kind: 'upgrade', why: 'the replacement did not exist at call time — the original call stood on what was available' };
  }
  if (DRIFT_PATTERN.test(input.reason)) {
    return { kind: 'drift', why: 'price, licence or availability moved after the call' };
  }
  return { kind: 'correction', why: 'the replacement was available at call time and was not picked' };
}
