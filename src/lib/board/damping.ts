/**
 * Hysteresis for auto-applied board proposals.
 *
 * With nobody reviewing proposals, every bit of LLM run-to-run noise used to
 * land on the board as a pick change: duplicate proposals for one task in a
 * single response applied back to back, "A + B" → "B + A" logged as a flip,
 * and reruns walking a cell A → B → A inside an hour. The published pick
 * longevity (median held 0d) and reversal rate measured that noise, not our
 * judgement. Three rules damp it:
 *
 *   same pick   — a reorder or cosmetic rewrite of the same combo is not a
 *                 change (pickKey below). Applies on every path.
 *   min hold    — automation may not change a cell again within minHoldDays
 *                 of its last change. No evidence escape: the board is weekly,
 *                 and a deprecation inside that window waits one run.
 *   revert      — automation may not flip a cell back to a pick it replaced
 *                 within revertWindowDays UNLESS there is new evidence: a
 *                 curated story naming that pick, created after it was
 *                 replaced. Without new evidence a revert just undoes the
 *                 last call with the same information the last call had.
 *
 * The admin approve route stays undamped: a human who read the rationale and
 * clicked approve is the evidence.
 */
import { and, eq, gt, or, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { stories } from '../db/schema';

const DAY_MS = 86_400_000;

/** Separators that join a combo pick ("Cursor + Claude Sonnet 4.5"). A bare "/" stays (it shows up inside names). */
const COMBO_SPLIT = /\s*(?:\+|&|,|\s\/\s|\sand\s)\s*/;

/** Lowercased, whitespace/dash-normalised, order-independent parts of a pick name. */
export function pickParts(name: string): string[] {
  const norm = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)/g, ')')
    .trim();
  const parts = norm
    .split(COMBO_SPLIT)
    .map((p) => p.replace(/^[\s"'`.;:]+|[\s"'`.;:]+$/g, '').trim())
    .filter((p) => p.length > 0);
  return [...new Set(parts)].sort();
}

/** Canonical key for pick equality. */
export function pickKey(name: string): string {
  return pickParts(name).join(' + ');
}

/** True when two pick strings name the same tool or the same combo, in any order or casing. */
export function samePick(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return pickKey(a) === pickKey(b);
}

export interface DampingPolicy {
  minHoldDays: number;
  revertWindowDays: number;
}

/** minHoldDays sits under the weekly cadence so the Monday cron is never held by the previous Monday. */
export const DEFAULT_DAMPING: DampingPolicy = { minHoldDays: 6, revertWindowDays: 30 };

function envDays(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** BOARD_MIN_HOLD_DAYS / BOARD_REVERT_WINDOW_DAYS override the defaults; 0 disables a rule. */
export function dampingPolicyFromEnv(env: Record<string, string | undefined> = process.env): DampingPolicy {
  return {
    minHoldDays: envDays(env.BOARD_MIN_HOLD_DAYS, DEFAULT_DAMPING.minHoldDays),
    revertWindowDays: envDays(env.BOARD_REVERT_WINDOW_DAYS, DEFAULT_DAMPING.revertWindowDays),
  };
}

/** One kit_pick_history row for the cell being decided. */
export interface CellChange {
  fromPick: string | null;
  toPick: string;
  changedAt: Date;
}

export type PickDecision =
  | { kind: 'apply' }
  | { kind: 'same' }
  | { kind: 'hold'; rule: 'min-hold' | 'revert'; since: Date; why: string };

export interface DecideInput {
  /** Current pick for the cell, null when the cell has none. */
  current: string | null;
  proposed: string;
  /** The cell's pick history, any order. */
  history: CellChange[];
  now: Date;
  policy: DampingPolicy;
  /** Is there evidence about `pick` newer than `since`? */
  hasNewEvidence: (pick: string, since: Date) => boolean;
}

function daysAgo(now: Date, then: Date): number {
  return Math.floor((now.getTime() - then.getTime()) / DAY_MS);
}

/** Pure: should this proposed pick replace the current one? */
export function decidePickChange(input: DecideInput): PickDecision {
  const { current, proposed, now, policy } = input;
  if (current === null) return { kind: 'apply' };
  if (samePick(current, proposed)) return { kind: 'same' };

  const history = [...input.history].sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());

  const last = history[0];
  if (last && now.getTime() - last.changedAt.getTime() < policy.minHoldDays * DAY_MS) {
    return {
      kind: 'hold',
      rule: 'min-hold',
      since: last.changedAt,
      why: `changed ${daysAgo(now, last.changedAt)}d ago, min hold ${policy.minHoldDays}d`,
    };
  }

  const replaced = history.find((h) => h.fromPick !== null && samePick(h.fromPick, proposed));
  if (
    replaced &&
    now.getTime() - replaced.changedAt.getTime() < policy.revertWindowDays * DAY_MS &&
    !input.hasNewEvidence(proposed, replaced.changedAt)
  ) {
    return {
      kind: 'hold',
      rule: 'revert',
      since: replaced.changedAt,
      why: `revert to ${proposed} blocked: replaced ${daysAgo(now, replaced.changedAt)}d ago, no news naming it since`,
    };
  }

  return { kind: 'apply' };
}

/**
 * Evidence proxy for the revert rule: a curated story created after `since`
 * whose title or TL;DR names the pick (any combo part of 3+ chars). It is the
 * same "entered our field of view" proxy the verdict grader uses — the news is
 * the freshness signal the proposal prompt is told to trust.
 */
export function storyEvidenceSince(pick: string, since: Date): boolean {
  const needles = pickParts(pick).filter((p) => p.length >= 3);
  if (needles.length === 0) return false;
  const matches = needles.map((n) => {
    const pattern = `%${n.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return or(
      sql`lower(${stories.title}) like ${pattern} escape '\\'`,
      sql`lower(coalesce(${stories.tldr}, '')) like ${pattern} escape '\\'`,
    );
  });
  const row = getDb()
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gt(stories.createdAt, since), or(...matches)))
    .limit(1)
    .get();
  return row !== undefined;
}
