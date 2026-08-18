import { and, desc, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { items, stories } from '../db/schema';
import { bufferToVec, cosine, vecToBuffer } from '../vec';

/** Same bar as the curated-story dedup: true dupes sit at 0.90+, related-but-distinct ~0.75-0.85. */
const MERGE_THRESHOLD = 0.87;
/** Candidates and targets both live in the 72h display window. */
const WINDOW_MS = 72 * 36e5;
/** Cap per run so a first-boot backlog can't block curation for minutes. */
const TARGET_LIMIT = 100;

export type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;

/**
 * Semantic pre-dedup, run between lexical clustering and the LLM curation
 * call: embed 'raw' stories and merge reworded duplicates into existing
 * stories (title-Jaccard misses those; each surviving dupe would burn a
 * curation call and split the score evidence). A merge relinks the dupe's
 * items to the canonical story, bumps its updatedAt (freshness + re-curation
 * trigger) and deletes the raw row. Survivors keep their embedding — they
 * become tomorrow's candidates for free.
 *
 * The default embedder lazy-loads the ONNX model (worker-only); tests inject
 * `opts.embed`.
 */
export async function semanticPreDedup(opts: { embed?: EmbedFn } = {}): Promise<{ embedded: number; merged: number }> {
  const db = getDb();
  const cutoff = new Date(Date.now() - WINDOW_MS);

  const candidates = db
    .select({ id: stories.id, embedding: stories.embedding })
    .from(stories)
    .where(and(gte(stories.createdAt, cutoff), isNotNull(stories.embedding)))
    .all();

  const targets = db
    .select({ id: stories.id, title: stories.title })
    .from(stories)
    .where(and(eq(stories.status, 'raw'), isNull(stories.embedding), gte(stories.createdAt, cutoff)))
    .orderBy(desc(stories.createdAt), desc(stories.id))
    .limit(TARGET_LIMIT)
    .all();

  if (targets.length === 0) return { embedded: 0, merged: 0 };

  const embed = opts.embed ?? (await import('../embed')).embedTexts;

  // text = story title + first member-item title when it adds signal
  const texts = targets.map((t) => {
    const first = db
      .select({ title: items.title })
      .from(items)
      .where(eq(items.storyId, t.id))
      .orderBy(items.id)
      .limit(1)
      .get();
    return first && first.title !== t.title ? `${t.title}\n${first.title}` : t.title;
  });
  const vectors = await embed(texts);

  const pool = candidates.map((c) => ({ id: c.id, vec: bufferToVec(c.embedding as Buffer) }));
  const now = new Date();
  let merged = 0;

  for (let i = 0; i < targets.length; i++) {
    const vec = vectors[i];
    let bestId: number | null = null;
    let best = 0;
    for (const c of pool) {
      const sim = cosine(vec, c.vec);
      if (sim >= MERGE_THRESHOLD && sim > best) {
        best = sim;
        bestId = c.id;
      }
    }
    if (bestId !== null) {
      const canonical = db.select({ title: stories.title }).from(stories).where(eq(stories.id, bestId)).get();
      db.update(items).set({ storyId: bestId }).where(eq(items.storyId, targets[i].id)).run();
      db.update(stories).set({ updatedAt: now }).where(eq(stories.id, bestId)).run();
      db.delete(stories).where(eq(stories.id, targets[i].id)).run();
      merged++;
      console.log(`[semantic-dedup] merged "${targets[i].title}" → "${canonical?.title ?? bestId}"`);
    } else {
      // survivor: keep the vector so later targets in this batch (and the next
      // run) can match against it without re-embedding
      db.update(stories).set({ embedding: vecToBuffer(vec) }).where(eq(stories.id, targets[i].id)).run();
      pool.push({ id: targets[i].id, vec });
    }
  }

  return { embedded: targets.length, merged };
}
