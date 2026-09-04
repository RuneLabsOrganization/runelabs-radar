import { asc, eq, gte, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { items, stories } from '../db/schema';

/**
 * THE 72h display/curation window — the one definition. The curation batch,
 * curated-story dedup, semantic pre-dedup and clustering all read stories
 * inside it; duplicated copies (there were four, in two spellings) silently
 * diverge the day someone tunes it.
 */
export const CURATION_WINDOW_MS = 72 * 36e5;
/**
 * Clamp floor sits 1h INSIDE the window: clamping a backfilled story to
 * exactly now−72h would park it on the gte() edge where one slow tick pushes
 * it out before it is ever scored.
 */
const CLAMP_FLOOR_MS = CURATION_WINDOW_MS - 36e5;
/** Jaccard similarity at or above this merges an item into a story. */
const SIMILARITY_THRESHOLD = 0.55;
/** Feed clock skew is tolerated this far into the future; more pins a story atop every batch. */
const FUTURE_TOLERANCE_MS = 15 * 60 * 1000;

/**
 * Feed-supplied published dates are untrusted: a stale one (>72h) puts the
 * story outside every windowed read forever, a far-future one pins it at the
 * top of each curation batch. Clamp into [now-71h, now+15min] — the floor is
 * 1h inside the curation window so a clamped story still gets a real chance to
 * be scored. Exported for tests.
 */
export function clampPublishedAt(d: Date, now = new Date()): Date {
  const t = d.getTime();
  const min = now.getTime() - CLAMP_FLOOR_MS;
  const max = now.getTime() + FUTURE_TOLERANCE_MS;
  if (t < min) return new Date(min);
  if (t > max) return new Date(max);
  return d;
}

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

/**
 * Pure-digit tokens are version/number noise ('4', '5', '2024'). Alnum tokens
 * like 'o3' or 'gpt4' are names, not versions — they count as content.
 */
function isVersionToken(tok: string): boolean {
  return /^\d+$/.test(tok);
}

/**
 * Similarity over two precomputed token sets; an empty set never matches.
 *
 * Base: Jaccard, with one version guard — when both titles carry version
 * tokens and the version SETS differ ("Claude 4.5 pricing" vs "Claude 4.6
 * pricing"), shared version tokens don't count toward the intersection:
 * different versions of the same product are DIFFERENT releases, and letting
 * '4' bridge them merges distinct news. Identical version sets count in full
 * (same release is real evidence).
 *
 * Short-title rule: with ≤3 content tokens per side the attainable Jaccard
 * values are only {0, 1/3, 1/2, 1}, so reworded same-news ("Claude Code
 * pricing" vs "Claude Code launch" = 1/2) can never clear the 0.55 bar. Two
 * shared non-version tokens there are evidence enough — the rule returns
 * exactly the merge bar. Documented trade-off: pairs whose shared evidence is
 * mostly version tokens with everything else identical ("Claude 4.5 pricing"
 * vs "GPT 4.5 pricing") still merge; a token Jaccard cannot separate product
 * names from generic news words — the semantic layer catches gross errors.
 */
function tokenSimilarity(setA: ReadonlySet<string>, setB: ReadonlySet<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  const versionA = [...setA].filter(isVersionToken);
  const versionB = [...setB].filter(isVersionToken);
  // versions "disagree" only when BOTH sides carry version tokens and the
  // sets differ; a title with no version tokens can't disagree about versions
  const sameRelease =
    versionA.length === 0 ||
    versionB.length === 0 ||
    (versionA.every((t) => setB.has(t)) && versionB.every((t) => setA.has(t)));
  let shared = 0;
  let sharedVersion = 0;
  let sharedContent = 0;
  for (const tok of setA) {
    if (!setB.has(tok)) continue;
    shared++;
    if (isVersionToken(tok)) sharedVersion++;
    else sharedContent++;
  }
  const union = setA.size + setB.size - shared;
  const intersection = sameRelease ? shared : shared - sharedVersion;
  const jaccard = intersection / union;
  if (sharedContent >= 2 && Math.min(setA.size, setB.size) <= 3) {
    return Math.max(jaccard, SIMILARITY_THRESHOLD);
  }
  return jaccard;
}

/** Jaccard similarity (0..1) over the token sets of two titles. */
export function titleSimilarity(a: string, b: string): number {
  return tokenSimilarity(new Set(normalizeTitle(a)), new Set(normalizeTitle(b)));
}

/**
 * Assigns every unclustered item (storyId null) to a story:
 * merged into the most similar story created in the last 72h when
 * titleSimilarity >= 0.55, otherwise a fresh 'raw' story is created
 * (title = item title, createdAt = publishedAt ?? fetchedAt, clamped into
 * [now-71h, now+15min] — feed dates are untrusted, and the floor stays 1h
 * inside the 72h window so a clamped story still gets scored).
 * Stories created during this run are immediately eligible candidates,
 * so same-batch duplicates cluster together.
 */
export async function clusterNewItems(): Promise<{ newStories: number; merged: number }> {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - CURATION_WINDOW_MS);

  // Candidate token sets are computed once (here and at push time for stories
  // created during the run), not once per item × candidate pair.
  const candidates: { id: number; tokens: Set<string> }[] = db
    .select({ id: stories.id, title: stories.title })
    .from(stories)
    .where(gte(stories.createdAt, cutoff))
    .all()
    .map((c) => ({ id: c.id, tokens: new Set(normalizeTitle(c.title)) }));

  const unclustered = db
    .select()
    .from(items)
    .where(isNull(items.storyId))
    .orderBy(asc(items.id))
    .all();

  let newStories = 0;
  let merged = 0;

  for (const item of unclustered) {
    const itemTokens = new Set(normalizeTitle(item.title));
    let bestId: number | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = tokenSimilarity(itemTokens, candidate.tokens);
      if (score >= SIMILARITY_THRESHOLD && score > bestScore) {
        bestScore = score;
        bestId = candidate.id;
      }
    }

    if (bestId !== null) {
      db.transaction((tx) => {
        tx.update(items).set({ storyId: bestId }).where(eq(items.id, item.id)).run();
        // a merge is fresh coverage: bump the story so "new since last visit"
        // and re-curation see it (createdAt alone can't — it's the FIRST item's date)
        tx.update(stories).set({ updatedAt: new Date() }).where(eq(stories.id, bestId)).run();
      });
      merged++;
    } else {
      // insert + link atomically: a failure mid-pair must not leave an
      // item-less orphan story behind
      const story = db.transaction((tx) => {
        const created = tx
          .insert(stories)
          .values({
            title: item.title,
            status: 'raw',
            createdAt: clampPublishedAt(item.publishedAt ?? item.fetchedAt, now),
          })
          .returning({ id: stories.id })
          .get();
        tx.update(items).set({ storyId: created.id }).where(eq(items.id, item.id)).run();
        return created;
      });
      candidates.push({ id: story.id, tokens: itemTokens });
      newStories++;
    }
  }

  return { newStories, merged };
}
