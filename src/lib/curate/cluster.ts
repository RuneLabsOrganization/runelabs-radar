import { asc, eq, gte, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { items, stories } from '../db/schema';

/** Stories created within this window are clustering candidates. */
const CLUSTER_WINDOW_MS = 72 * 60 * 60 * 1000;
/** Jaccard similarity at or above this merges an item into a story. */
const SIMILARITY_THRESHOLD = 0.55;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet',
  'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as',
  'into', 'onto', 'over', 'under', 'about', 'after', 'before', 'between',
  'through', 'during', 'without', 'within', 'along', 'across', 'behind',
  'beyond', 'up', 'down', 'out', 'off', 'above', 'below',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'done', 'have', 'has', 'had', 'having',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'it', 'its', 'itself', 'this', 'that', 'these', 'those', 'there', 'here',
  'then', 'than', 'too', 'very', 'just', 'not', 'no', 'now',
  'how', 'what', 'when', 'where', 'who', 'whom', 'whose', 'why', 'which',
  'i', 'me', 'my', 'we', 'our', 'ours', 'you', 'your', 'yours',
  'he', 'him', 'his', 'she', 'her', 'hers', 'they', 'them', 'their', 'theirs',
  's', 't', 'via', 'vs', 'also', 'more', 'most', 'other', 'some', 'such',
  'only', 'own', 'same', 'both', 'each', 'few', 'all', 'any',
  'if', 'because', 'while', 'until', 'again', 'further', 'once',
]);

/** Lowercase, strip punctuation, drop english stopwords → content tokens. */
export function normalizeTitle(t: string): string[] {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((tok) => tok.length > 0 && !STOPWORDS.has(tok));
}

/** Jaccard similarity (0..1) over the token sets of two titles. */
export function titleSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeTitle(a));
  const setB = new Set(normalizeTitle(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/**
 * Assigns every unclustered item (storyId null) to a story:
 * merged into the most similar story created in the last 72h when
 * titleSimilarity >= 0.55, otherwise a fresh 'raw' story is created
 * (title = item title, createdAt = publishedAt ?? fetchedAt).
 * Stories created during this run are immediately eligible candidates,
 * so same-batch duplicates cluster together.
 */
export async function clusterNewItems(): Promise<{ newStories: number; merged: number }> {
  const db = getDb();
  const cutoff = new Date(Date.now() - CLUSTER_WINDOW_MS);

  const candidates: { id: number; title: string }[] = db
    .select({ id: stories.id, title: stories.title })
    .from(stories)
    .where(gte(stories.createdAt, cutoff))
    .all();

  const unclustered = db
    .select()
    .from(items)
    .where(isNull(items.storyId))
    .orderBy(asc(items.id))
    .all();

  let newStories = 0;
  let merged = 0;

  for (const item of unclustered) {
    let bestId: number | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = titleSimilarity(item.title, candidate.title);
      if (score >= SIMILARITY_THRESHOLD && score > bestScore) {
        bestScore = score;
        bestId = candidate.id;
      }
    }

    if (bestId !== null) {
      db.update(items).set({ storyId: bestId }).where(eq(items.id, item.id)).run();
      merged++;
    } else {
      const story = db
        .insert(stories)
        .values({
          title: item.title,
          status: 'raw',
          createdAt: item.publishedAt ?? item.fetchedAt,
        })
        .returning({ id: stories.id })
        .get();
      db.update(items).set({ storyId: story.id }).where(eq(items.id, item.id)).run();
      candidates.push({ id: story.id, title: item.title });
      newStories++;
    }
  }

  return { newStories, merged };
}
