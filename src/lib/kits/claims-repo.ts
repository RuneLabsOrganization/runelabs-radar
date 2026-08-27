/**
 * The only impure claims module: open, find and close claim rows.
 * Grading outcomes is the verdict-grade job's job, not this module's.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { verdictClaims } from '../db/schema';
import type { NewClaim } from './claims';
import type { KitTier } from './grid';

export type Claim = typeof verdictClaims.$inferSelect;

export interface ClaimCell {
  category: string;
  task: string;
  tier: KitTier;
}

export function openClaim(claim: NewClaim): void {
  getDb().insert(verdictClaims).values(claim).run();
}

/** The newest still-open claim for a cell, or null. */
export function openClaimFor(cell: ClaimCell): Claim | null {
  return (
    getDb()
      .select()
      .from(verdictClaims)
      .where(
        and(
          eq(verdictClaims.category, cell.category),
          eq(verdictClaims.task, cell.task),
          eq(verdictClaims.tier, cell.tier),
          isNull(verdictClaims.closedAt),
        ),
      )
      .orderBy(desc(verdictClaims.openedAt))
      .limit(1)
      .get() ?? null
  );
}

/**
 * Stamp the open claim closed. Outcome is deliberately left null — the pick
 * changing tells us the claim ended, not why it ended.
 */
export function closeOpenClaim(cell: ClaimCell, at: Date): void {
  const open = openClaimFor(cell);
  if (!open) return;
  getDb().update(verdictClaims).set({ closedAt: at }).where(eq(verdictClaims.id, open.id)).run();
}

/** Record the grader's judgement on a closed claim. */
export function setClaimOutcome(id: number, outcome: NonNullable<Claim['outcome']>): void {
  getDb().update(verdictClaims).set({ outcome }).where(eq(verdictClaims.id, id)).run();
}
