/**
 * Feed aggregates shared by the briefing (Today) and sector (domain) pages —
 * one query per aggregate, grouped in JS. These used to be implemented inline
 * on both pages with subtly different guards; the sector page drifted (its
 * "new" marker ignored merged-in coverage). Anything a feed page derives from
 * items/votes/story timestamps belongs here so the pages cannot diverge.
 */
import { eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { items, sources, votes } from './db/schema';

export type ItemAgg = { count: number; firstUrl: string | null; sourceName: string | null };
export type VoteAgg = { up: number; down: number; mine: 1 | -1 | 0 };

/** Item count + first link (lowest items.id) per story. */
export function itemAggByStory(storyIds: number[]): Map<number, ItemAgg> {
  const map = new Map<number, ItemAgg>();
  if (storyIds.length === 0) return map;
  const db = getDb();
  const rows = db
    .select({ storyId: items.storyId, url: items.url, sourceName: sources.name })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(inArray(items.storyId, storyIds))
    .orderBy(items.id)
    .all();
  for (const row of rows) {
    if (row.storyId == null) continue;
    const agg = map.get(row.storyId) ?? { count: 0, firstUrl: null, sourceName: null };
    agg.count += 1;
    if (agg.firstUrl === null) {
      agg.firstUrl = row.url;
      agg.sourceName = row.sourceName;
    }
    map.set(row.storyId, agg);
  }
  return map;
}

/**
 * Up/down totals plus the viewer's own vote. `userId: null` is the anonymous
 * case and matches no rows — do not substitute a sentinel id: any real id
 * would attribute a stranger's vote to the viewer.
 */
export function voteAggByStory(storyIds: number[], userId: number | null): Map<number, VoteAgg> {
  const map = new Map<number, VoteAgg>();
  if (storyIds.length === 0) return map;
  const db = getDb();
  const rows = db.select().from(votes).where(inArray(votes.storyId, storyIds)).all();
  for (const row of rows) {
    const agg = map.get(row.storyId) ?? { up: 0, down: 0, mine: 0 };
    if (row.value === 1) agg.up += 1;
    else if (row.value === -1) agg.down += 1;
    if (userId != null && row.userId === userId && (row.value === 1 || row.value === -1)) {
      agg.mine = row.value;
    }
    map.set(row.storyId, agg);
  }
  return map;
}

export type Freshness = {
  isNew: boolean;
  /** merged-in coverage since the anchor but not itself new — gets the amber marker */
  isUpdated: boolean;
};

/**
 * Freshness vs the viewer's last-visit anchor: a story is new when it was
 * created after the anchor OR when a merge bumped its updatedAt past it — a
 * story that gained fresh coverage must read as "new" on every page, not just
 * the briefing. Anonymous viewers (null anchor) see nothing as new.
 */
export function freshnessVsAnchor(
  story: { createdAt: Date; updatedAt: Date | null },
  anchor: Date | null,
): Freshness {
  const createdFresh = anchor !== null && story.createdAt > anchor;
  const mergedFresh = anchor !== null && story.updatedAt !== null && story.updatedAt > anchor;
  return { isNew: createdFresh || mergedFresh, isUpdated: !createdFresh && mergedFresh };
}
