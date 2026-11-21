/**
 * Building a verdict claim. Pure — no DB.
 *
 * The design decision worth defending: a falsifier only counts if it was
 * stated BEFORE the outcome was known, by whoever made the call. The board
 * proposal generator now states one in the same model call that makes the
 * pick (src/lib/board/sync.ts), so an auto-applied pick arrives with its
 * falsifier already attached — that is pre-registration, the same as a
 * reviewer writing one at approval time. What we deliberately never do is
 * generate a falsifier afterwards, in a separate pass, for a claim that was
 * opened without one: a falsifier written once the outcome is in view would
 * make coverage look complete while measuring nothing, which is worse than an
 * honest gap. So when the call states none, the claim gets the UNREGISTERED
 * sentinel and counts against coverage.
 */
import type { verdictClaims } from '../db/schema';
import type { KitTier } from './grid';

export type NewClaim = typeof verdictClaims.$inferInsert & { evidenceSnapshot: string };

/** Sentinel for "this call was made without stating what would disprove it". */
export const UNREGISTERED = 'unregistered';

/** How long a pick is expected to hold before it is re-examined. */
export const DEFAULT_HORIZON_DAYS = 90;

export interface BuildClaimInput {
  category: string;
  task: string;
  tier: KitTier;
  pickName: string;
  falsifier?: string;
  horizonDays?: number;
  evidence?: string[];
  openedAt?: Date;
}

/** Longest falsifier we store — it is model output and gets published. */
export const MAX_FALSIFIER_CHARS = 500;

/**
 * Whitespace-collapsed, length-capped falsifier, or undefined when there is
 * nothing usable. Never invents text: no input, no falsifier.
 */
export function normalizeFalsifier(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length === 0 || text.toLowerCase() === UNREGISTERED) return undefined;
  return text.length > MAX_FALSIFIER_CHARS ? `${text.slice(0, MAX_FALSIFIER_CHARS - 1)}…` : text;
}

export function buildClaim(input: BuildClaimInput): NewClaim {
  const falsifier = normalizeFalsifier(input.falsifier);
  return {
    category: input.category,
    task: input.task,
    tier: input.tier,
    pickName: input.pickName,
    falsifier: falsifier ?? UNREGISTERED,
    horizonDays: input.horizonDays ?? DEFAULT_HORIZON_DAYS,
    evidenceSnapshot: JSON.stringify(input.evidence ?? []),
    openedAt: input.openedAt ?? new Date(),
    closedAt: null,
    outcome: null,
  };
}

/** Claims without a stated falsifier are excluded from accuracy maths. */
export function isGradable(claim: { falsifier: string }): boolean {
  return claim.falsifier !== UNREGISTERED;
}
