/**
 * The verdict-grade job: walk ungraded kit_pick_history rows, work out how long
 * the previous pick stood, decide what kind of change it was, and close out the
 * matching claim.
 *
 * "Did the replacement exist at call time" is answered from our own corpus: the
 * first curated story naming the tool. That is a proxy — it measures when the
 * tool entered OUR field of view, not when it shipped — and it is the honest
 * one available, because it is exactly the information the original call had.
 */
import { and, asc, eq, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { kitPickHistory, stories, verdictClaims } from '../db/schema';
import { classifyFlip } from '../kits/flip';

const DAY_MS = 86_400_000;

export async function runVerdictGrade(): Promise<{ graded: number }> {
  const db = getDb();
  const ungraded = db
    .select()
    .from(kitPickHistory)
    .where(eq(kitPickHistory.changeKind, 'unclassified'))
    .orderBy(asc(kitPickHistory.changedAt))
    .all()
    .filter((r) => r.heldDays === null);

  let graded = 0;

  for (const row of ungraded) {
    // The previous change to the same cell+tier tells us how long the old pick stood.
    const prev = db
      .select({ changedAt: kitPickHistory.changedAt })
      .from(kitPickHistory)
      .where(
        and(
          eq(kitPickHistory.category, row.category),
          eq(kitPickHistory.task, row.task),
          eq(kitPickHistory.tier, row.tier),
          lt(kitPickHistory.changedAt, row.changedAt),
          ne(kitPickHistory.id, row.id),
        ),
      )
      .orderBy(asc(kitPickHistory.changedAt))
      .all()
      .at(-1);

    const heldDays =
      prev?.changedAt != null
        ? Math.round((row.changedAt.getTime() - prev.changedAt.getTime()) / DAY_MS)
        : null;

    const seen = firstSeenAtNamed(row.toPick);
    const replacementExistedAtCall =
      seen !== null && prev?.changedAt != null ? seen.getTime() <= prev.changedAt.getTime() : false;

    const { kind } = classifyFlip({
      reason: row.reason,
      fromPick: row.fromPick,
      heldDays,
      replacementExistedAtCall,
    });

    db.update(kitPickHistory)
      .set({ changeKind: kind, heldDays: heldDays ?? -1 })
      .where(eq(kitPickHistory.id, row.id))
      .run();

    // Mirror the judgement onto the claim that just closed, if there is one.
    if (kind !== 'unclassified') {
      const claim = db
        .select()
        .from(verdictClaims)
        .where(
          and(
            eq(verdictClaims.category, row.category),
            eq(verdictClaims.task, row.task),
            eq(verdictClaims.tier, row.tier),
            eq(verdictClaims.pickName, row.fromPick ?? ''),
            isNotNull(verdictClaims.closedAt),
          ),
        )
        .orderBy(asc(verdictClaims.openedAt))
        .all()
        .at(-1);
      if (claim) {
        db.update(verdictClaims).set({ outcome: kind }).where(eq(verdictClaims.id, claim.id)).run();
      }
    }

    graded += 1;
  }

  return { graded };
}

/** First curated story whose title names the tool, or null. */
function firstSeenAtNamed(name: string): Date | null {
  const needle = name.trim().toLowerCase();
  if (needle.length < 3) return null;
  // Escaped LIKE with LIMIT 1 over the (status, created_at) index — the old
  // in-JS .find() full-scanned every curated story once per ungraded row.
  // Wildcards in the tool name must match literally, not broaden the match.
  const escaped = needle.replace(/[\\%_]/g, (c) => `\\${c}`);
  const row = getDb()
    .select({ createdAt: stories.createdAt })
    .from(stories)
    .where(
      and(
        eq(stories.status, 'curated'),
        sql`lower(${stories.title}) like ${'%' + escaped + '%'} escape '\\'`,
      ),
    )
    .orderBy(asc(stories.createdAt))
    .limit(1)
    .get();
  return row?.createdAt ?? null;
}
