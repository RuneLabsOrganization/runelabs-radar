import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { items, stories, votes } from '../db/schema';
import { bufferToVec, cosine } from '../vec';

/** Stories created within this window are dedup candidates. */
const WINDOW_MS = 72 * 36e5;
/**
 * Cosine at/above this merges two curated stories. Conservative on purpose:
 * normalized MiniLM vectors put true duplicates at 0.90+, related-but-
 * distinct stories at ~0.75-0.85. False merges are worse than dupes.
 */
export const MERGE_THRESHOLD = 0.87;

interface Candidate {
  id: number;
  title: string;
  tldr: string | null;
  whyItMatters: string | null;
  domainScores: string | null;
  topScore: number;
  createdAt: Date;
  vec: Float32Array;
}

/**
 * Semantic dedup: merges curated stories that are the same news under
 * different titles (title-Jaccard misses those). Runs after the embed job
 * writes vectors. The YOUNGER story merges into the OLDER one: items and
 * votes move over, the better curated payload (higher top_score) wins, and
 * the younger story row is deleted. Every merge is logged.
 */
export async function mergeSimilarStories(
  now: number = Date.now(),
): Promise<{ pairs: number; merged: number }> {
  const db = getDb();
  const rows = db
    .select()
    .from(stories)
    .where(
      and(
        eq(stories.status, 'curated'),
        isNotNull(stories.embedding),
        gte(stories.createdAt, new Date(now - WINDOW_MS)),
      ),
    )
    .all()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); // older first = canonical

  const candidates: Candidate[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    tldr: r.tldr,
    whyItMatters: r.whyItMatters,
    domainScores: r.domainScores,
    topScore: r.topScore,
    createdAt: r.createdAt,
    vec: bufferToVec(r.embedding as Buffer),
  }));

  // union-find so chains (A~B, B~C) collapse into one canonical story
  const parent = new Map<number, number>();
  const root = (x: number): number => {
    let r = x;
    while (parent.get(r) !== undefined) r = parent.get(r)!;
    return r;
  };

  let pairs = 0;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (cosine(candidates[i].vec, candidates[j].vec) >= MERGE_THRESHOLD) {
        pairs++;
        // younger (later in array) points at older
        parent.set(root(candidates[j].id), root(candidates[i].id));
      }
    }
  }

  // group by canonical root; merge every non-root member into the root
  const byRoot = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const r = root(c.id);
    if (!byRoot.has(r)) byRoot.set(r, []);
    if (c.id !== r) byRoot.get(r)!.push(c);
  }

  let merged = 0;
  for (const [rootId, members] of byRoot) {
    if (members.length === 0) continue;
    const canonical = candidates.find((c) => c.id === rootId)!;
    for (const dup of members) {
      // better curated payload wins
      const takePayload = dup.topScore > canonical.topScore;
      // vote move + item relink + payload swap + delete atomically: a crash
      // mid-sequence must not leave half-moved votes or orphaned items
      db.transaction((tx) => {
        // a user may have voted on both — drop the dup-side vote first
        tx.run(
          sql`DELETE FROM votes WHERE story_id = ${dup.id} AND user_id IN (SELECT user_id FROM votes WHERE story_id = ${rootId})`,
        );
        tx.update(votes).set({ storyId: rootId }).where(eq(votes.storyId, dup.id)).run();
        tx.update(items).set({ storyId: rootId }).where(eq(items.storyId, dup.id)).run();

        if (takePayload) {
          tx.update(stories)
            .set({
              topScore: dup.topScore,
              domainScores: dup.domainScores,
              tldr: dup.tldr,
              whyItMatters: dup.whyItMatters,
            })
            .where(eq(stories.id, rootId))
            .run();
        }

        tx.delete(stories).where(eq(stories.id, dup.id)).run();
      });
      if (takePayload) canonical.topScore = dup.topScore;
      merged++;
      console.log(`[dedup] merged "${dup.title}" → "${canonical.title}"`);
    }
  }

  return { pairs, merged };
}
