import { and, desc, eq, gte, isNotNull, isNull, ne } from 'drizzle-orm';
import { getDb } from '../db';
import { items, stories } from '../db/schema';
import { bufferToVec, cosine, vecToBuffer } from '../vec';
import { CURATION_WINDOW_MS } from './cluster';
import { MERGE_THRESHOLD } from './dedup';

/** Cap per run so a first-boot backlog can't block curation for minutes. */
const TARGET_LIMIT = 100;
/** Member-item titles embedded alongside the story title — the first item alone is often unrepresentative. */
const EMBED_ITEM_TITLES = 3;
/** Soft bound on the embedded text; MiniLM truncates hard at 256 tokens anyway. */
const EMBED_TEXT_CHARS = 600;

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
  const cutoff = new Date(Date.now() - CURATION_WINDOW_MS);

  // 'filtered' stories are excluded: merging into one would keep it filtered
  // (the gate never re-runs) and the dupe's items would vanish with it.
  const candidates = db
    .select({ id: stories.id, embedding: stories.embedding })
    .from(stories)
    .where(and(gte(stories.createdAt, cutoff), isNotNull(stories.embedding), ne(stories.status, 'filtered')))
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

  // text = story title + up to 3 member-item titles: a story whose FIRST item
  // is unrepresentative would otherwise get a permanently skewed vector
  const texts = targets.map((t) => {
    const memberTitles = db
      .select({ title: items.title })
      .from(items)
      .where(eq(items.storyId, t.id))
      .orderBy(items.id)
      .limit(EMBED_ITEM_TITLES)
      .all();
    return [t.title, ...memberTitles.map((r) => r.title).filter((x) => x !== t.title)]
      .join('\n')
      .slice(0, EMBED_TEXT_CHARS);
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
      // relink + bump + delete atomically: a crash mid-merge must not strand
      // the dupe's items on a deleted story or bump without merging
      db.transaction((tx) => {
        tx.update(items).set({ storyId: bestId }).where(eq(items.storyId, targets[i].id)).run();
        tx.update(stories).set({ updatedAt: now }).where(eq(stories.id, bestId)).run();
        tx.delete(stories).where(eq(stories.id, targets[i].id)).run();
      });
      merged++;
      console.log(`[semantic-dedup] merged "${targets[i].title}" → "${canonical?.title ?? bestId}"`);
    } else {
      // never persist a broken vector: NaN compares false against every bar,
      // leaving the story as permanent dead weight in the candidate pool.
      // embedding stays null so the next run retries it.
      let finite = true;
      for (const x of vec) {
        if (!Number.isFinite(x)) {
          finite = false;
          break;
        }
      }
      if (!finite) {
        console.warn(`[semantic-dedup] non-finite embedding for story ${targets[i].id} — left null for retry`);
        continue;
      }
      // survivor: keep the vector so later targets in this batch (and the next
      // run) can match against it without re-embedding
      db.update(stories).set({ embedding: vecToBuffer(vec) }).where(eq(stories.id, targets[i].id)).run();
      pool.push({ id: targets[i].id, vec });
    }
  }

  return { embedded: targets.length, merged };
}
