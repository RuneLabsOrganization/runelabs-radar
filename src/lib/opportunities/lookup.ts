/**
 * Resolve one opportunity the caller is allowed to see.
 * Numeric refs look up by id; everything else is a slug. On a slug collision
 * between a public radar row and the caller's private fork, the private row wins.
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { opportunities } from '../db/schema';
import { visibleTo } from './scope';

export function lookupVisibleOpportunity(ref: string, userId: number | null) {
  const trimmed = ref.trim();
  if (!trimmed) return undefined;
  const db = getDb();
  const scope = visibleTo(userId);
  const asId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  if (asId != null) {
    return db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, asId), scope))
      .get();
  }
  return db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.slug, trimmed), scope))
    .orderBy(desc(opportunities.ownerUserId))
    .get();
}
