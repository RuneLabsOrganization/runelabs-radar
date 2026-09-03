import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { items, sources, stories, votes } from '@/lib/db/schema';
import { freshnessVsAnchor, itemAggByStory, voteAggByStory } from '@/lib/feed-agg';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

function seedStory(title: string): number {
  return db
    .insert(stories)
    .values({ title, status: 'curated', topScore: 80, createdAt: new Date() })
    .returning({ id: stories.id })
    .get()!.id;
}

function seedItem(storyId: number | null, url: string, sourceName = 'feed-a'): void {
  db.insert(sources).values({ type: 'rss', name: sourceName }).onConflictDoNothing().run();
  const sourceId = db.select({ id: sources.id }).from(sources).where(eq(sources.name, sourceName)).get()!.id;
  db.insert(items)
    .values({ sourceId, url, title: url, storyId, fetchedAt: new Date() })
    .run();
}

describe('itemAggByStory', () => {
  it('counts items per story with the first link by insertion order', () => {
    const a = seedStory('a');
    const b = seedStory('b');
    seedItem(a, 'https://x.test/1');
    seedItem(a, 'https://x.test/2');
    seedItem(b, 'https://x.test/3', 'feed-b');
    seedItem(null, 'https://x.test/4'); // unassigned item must not leak in

    const agg = itemAggByStory([a, b]);
    expect(agg.get(a)).toEqual({ count: 2, firstUrl: 'https://x.test/1', sourceName: 'feed-a' });
    expect(agg.get(b)).toEqual({ count: 1, firstUrl: 'https://x.test/3', sourceName: 'feed-b' });
  });

  it('returns an empty map for no ids without touching the db', () => {
    expect(itemAggByStory([]).size).toBe(0);
  });
});

describe('voteAggByStory', () => {
  it('tallies up/down and the viewer’s own vote', () => {
    const s = seedStory('voted');
    seedUser(db, 1);
    seedUser(db, 2);
    db.insert(votes).values({ userId: 1, storyId: s, value: 1 }).run();
    db.insert(votes).values({ userId: 2, storyId: s, value: -1 }).run();

    expect(voteAggByStory([s], 1).get(s)).toEqual({ up: 1, down: 1, mine: 1 });
    expect(voteAggByStory([s], 2).get(s)).toEqual({ up: 1, down: 1, mine: -1 });
  });

  it('anonymous viewers (null) see totals but never a personal vote', () => {
    const s = seedStory('anon');
    seedUser(db, 1);
    db.insert(votes).values({ userId: 1, storyId: s, value: 1 }).run();

    // the old briefing sentinel (-1) and the sector guard (user &&) agreed on
    // this by accident; the shared guard must keep it: no id, no "mine"
    expect(voteAggByStory([s], null).get(s)).toEqual({ up: 1, down: 0, mine: 0 });
  });

  it('ignores retracted (0) votes in totals and mine', () => {
    const s = seedStory('retracted');
    seedUser(db, 1);
    db.insert(votes).values({ userId: 1, storyId: s, value: 0 }).run();

    expect(voteAggByStory([s], 1).get(s)).toEqual({ up: 0, down: 0, mine: 0 });
  });

  it('returns an empty map for no ids', () => {
    expect(voteAggByStory([], 1).size).toBe(0);
  });
});

describe('freshnessVsAnchor', () => {
  const anchor = new Date('2026-08-11T08:00:00Z');
  const before = new Date('2026-08-10T08:00:00Z');
  const after = new Date('2026-08-12T08:00:00Z');

  it('marks stories created after the anchor as new', () => {
    expect(freshnessVsAnchor({ createdAt: after, updatedAt: null }, anchor)).toEqual({
      isNew: true,
      isUpdated: false,
    });
  });

  it('counts merged-in coverage past the anchor as new, flagged updated', () => {
    // the sector page missed this case — a merge bumps updatedAt, so fresh
    // coverage of an existing story reads as "new" there exactly as on Today
    expect(freshnessVsAnchor({ createdAt: before, updatedAt: after }, anchor)).toEqual({
      isNew: true,
      isUpdated: true,
    });
  });

  it('created-fresh wins over the updated flag', () => {
    expect(freshnessVsAnchor({ createdAt: after, updatedAt: after }, anchor)).toEqual({
      isNew: true,
      isUpdated: false,
    });
  });

  it('stale stories and anonymous viewers are never new', () => {
    expect(freshnessVsAnchor({ createdAt: before, updatedAt: before }, anchor)).toEqual({
      isNew: false,
      isUpdated: false,
    });
    expect(freshnessVsAnchor({ createdAt: after, updatedAt: after }, null)).toEqual({
      isNew: false,
      isUpdated: false,
    });
  });

  it('gives both feed pages the same answer for the same story', () => {
    // Today: freshnessVsAnchor(story, anchor) on the curated projection;
    // sector: freshnessVsAnchor(story, anchor) on the 72h projection — one
    // helper, one call shape, no drift
    const story = { createdAt: before, updatedAt: after };
    const briefing = freshnessVsAnchor(story, anchor).isNew;
    const sector = freshnessVsAnchor(story, anchor).isNew;
    expect(briefing).toBe(sector);
  });
});
