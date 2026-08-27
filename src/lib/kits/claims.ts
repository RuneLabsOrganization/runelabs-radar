/**
 * Building a verdict claim. Pure — no DB.
 *
 * The design decision worth defending: when nobody supplies a falsifier we
 * write the UNREGISTERED sentinel rather than auto-generating a plausible one.
 * A generated falsifier would make coverage look complete while measuring
 * nothing, which is worse than an honest gap.
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

export function buildClaim(input: BuildClaimInput): NewClaim {
  const falsifier = input.falsifier?.trim();
  return {
    category: input.category,
    task: input.task,
    tier: input.tier,
    pickName: input.pickName,
    falsifier: falsifier && falsifier.length > 0 ? falsifier : UNREGISTERED,
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
