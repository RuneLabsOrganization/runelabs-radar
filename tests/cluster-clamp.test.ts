import { beforeEach, describe, expect, it } from 'vitest';
import { clampPublishedAt, clusterNewItems } from '@/lib/curate/cluster';
import { items, sources, stories } from '@/lib/db/schema';
import type { Db } from '@/lib/db';
import { useTestDb } from './helpers/db';

const H = 3_600_000;

describe('clampPublishedAt', () => {
  const now = new Date('2026-08-20T12:00:00Z');

  it('clamps a stale date to now-72h', () => {
    const stale = new Date(now.getTime() - 100 * H);
    expect(clampPublishedAt(stale, now).getTime()).toBe(now.getTime() - 72 * H);
  });

  it('clamps a far-future date to now+15min', () => {
    const future = new Date(now.getTime() + 48 * H);
    expect(clampPublishedAt(future, now).getTime()).toBe(now.getTime() + 15 * 60 * 1000);
  });

  it('leaves in-window dates (and slight future skew) untouched', () => {
    const normal = new Date(now.getTime() - 5 * H);
    expect(clampPublishedAt(normal, now).getTime()).toBe(normal.getTime());
    const skew = new Date(now.getTime() + 10 * 60 * 1000);
    expect(clampPublishedAt(skew, now).getTime()).toBe(skew.getTime());
  });
});

describe('clusterNewItems story-date clamping', () => {
  let db: Db;
  let sourceId: number;

  beforeEach(() => {
    db = useTestDb();
    sourceId = db
      .insert(sources)
      .values({ type: 'rss', name: 'Clamp Feed' })
      .returning({ id: sources.id })
      .get().id;
  });

  function insertItem(title: string, url: string, publishedAt: Date | null) {
    db.insert(items).values({ sourceId, url, title, fetchedAt: new Date(), publishedAt }).run();
  }

  it('a feed serving a stale date no longer buries the story: createdAt clamps to ~now-72h', async () => {
    insertItem('Ancient dated benchmark post', 'https://c.example/1', new Date(Date.now() - 400 * H));

    await clusterNewItems();

    const story = db.select().from(stories).all()[0];
    expect(story).toBeDefined();
    const expected = Date.now() - 72 * H;
    expect(Math.abs(story.createdAt.getTime() - expected)).toBeLessThan(30_000);
  });

  it('a feed serving a future date no longer pins the story: createdAt clamps to ~now+15min', async () => {
    insertItem('Tomorrow dated launch post', 'https://c.example/2', new Date(Date.now() + 72 * H));

    await clusterNewItems();

    const story = db.select().from(stories).all()[0];
    expect(story).toBeDefined();
    const expected = Date.now() + 15 * 60 * 1000;
    expect(Math.abs(story.createdAt.getTime() - expected)).toBeLessThan(30_000);
  });

  it('a normal recent publishedAt is used as-is', async () => {
    const published = new Date(Math.floor((Date.now() - 5 * H) / 1000) * 1000);
    insertItem('Normally dated story', 'https://c.example/3', published);

    await clusterNewItems();

    const story = db.select().from(stories).all()[0];
    expect(story.createdAt.getTime()).toBe(published.getTime());
  });
});
