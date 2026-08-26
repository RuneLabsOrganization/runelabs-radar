/**
 * Visibility predicates for the opportunities table.
 *
 * owner_user_id NULL = the canonical public radar, written by the daily engine.
 * Non-null = one builder's private opening (Rung 1/2 output).
 *
 * Every reader of `opportunities` must use one of these. A query with no
 * visibility predicate is a bug: it either leaks private openings onto a public
 * surface or makes a pipeline job do unbounded work on user data.
 */
import { eq, isNull, or, type SQL } from 'drizzle-orm';
import { opportunities } from '../db/schema';

/** Public radar only. Use on unauthenticated surfaces and pipeline jobs. */
export function publicOnly(): SQL {
  return isNull(opportunities.ownerUserId);
}

/** Public radar plus this caller's own private openings. */
export function visibleTo(userId: number | null): SQL {
  return userId == null
    ? isNull(opportunities.ownerUserId)
    : or(isNull(opportunities.ownerUserId), eq(opportunities.ownerUserId, userId))!;
}
