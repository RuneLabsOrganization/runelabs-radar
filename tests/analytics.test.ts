import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { items, sources, stories } from '@/lib/db/schema';
import {
  dailyDomainCounts,
  domainMomentum,
  echoStats,
  topEntities,
} from '@/lib/analytics';
import { sanitizeEntities } from '@/lib/curate/curate';
import { sanitizeInsights } from '@/lib/brief/brief';

const DAY = 864e5;

function insertStory(
  db: Db,
  opts: {
    title?: string;
    daysAgo: number;
    coding?: number;
    image?: number;
    entities?: { name: string; kind: string }[];
  },
) {
  return db
    .insert(stories)
    .values({
      title: opts.title ?? `story ${Math.random()}`,
      status: 'curated',
      topScore: Math.max(opts.coding ?? 0, opts.image ?? 0),
      domainScores: JSON.stringify({
        coding: opts.coding ?? 0,
        copy: 0,
        image: opts.image ?? 0,
        video: 0,
        ads: 0,
        agentic: 0,
      }),
      entities: opts.entities ? JSON.stringify(opts.entities) : null,
      createdAt: new Date(Date.now() - opts.daysAgo * DAY),
    })
    .returning()
    .get();
}

describe('analytics', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('dailyDomainCounts zero-fills days and buckets by domain membership', () => {
    insertStory(db, { daysAgo: 0, coding: 80 });
    insertStory(db, { daysAgo: 0, coding: 50, image: 45 });
    insertStory(db, { daysAgo: 2, image: 90 });
    insertStory(db, { daysAgo: 2, coding: 20 }); // below threshold — total only
    const days = dailyDomainCounts(7);
    expect(days).toHaveLength(7);
    const today = days[6];
    const twoBack = days[4];
    expect(today.total).toBe(2);
    expect(today.byDomain.coding).toBe(2);
    expect(today.byDomain.image).toBe(1);
    expect(twoBack.total).toBe(2);
    expect(twoBack.byDomain.image).toBe(1);
    expect(twoBack.byDomain.coding).toBe(0);
    expect(days[0].total).toBe(0); // zero-filled
  });

  it('domainMomentum compares this week to last week', () => {
    insertStory(db, { daysAgo: 1, coding: 80 });
    insertStory(db, { daysAgo: 2, coding: 80 });
    insertStory(db, { daysAgo: 9, coding: 80 });
    insertStory(db, { daysAgo: 10, image: 80 });
    const momentum = Object.fromEntries(domainMomentum().map((m) => [m.domain, m]));
    expect(momentum.coding.thisWeek).toBe(2);
    expect(momentum.coding.lastWeek).toBe(1);
    expect(momentum.coding.deltaPct).toBe(100);
    expect(momentum.image.thisWeek).toBe(0);
    expect(momentum.image.deltaPct).toBe(-100);
    expect(momentum.video.deltaPct).toBeNull(); // nothing either week
  });

  it('topEntities counts once per story, tracks prior-week counts, sorts by count', () => {
    const qwen = [{ name: 'Qwen4', kind: 'model' }];
    insertStory(db, { daysAgo: 1, coding: 80, entities: [...qwen, { name: 'qwen4', kind: 'model' }] });
    insertStory(db, { daysAgo: 2, coding: 80, entities: qwen });
    insertStory(db, { daysAgo: 3, coding: 80, entities: [{ name: 'Claude Code', kind: 'tool' }] });
    insertStory(db, { daysAgo: 9, coding: 80, entities: qwen });
    const top = topEntities(5);
    expect(top[0]).toMatchObject({ name: 'Qwen4', count: 2, prev: 1 });
    expect(top[1]).toMatchObject({ name: 'Claude Code', count: 1, prev: 0 });
  });

  it('echoStats counts multi-source stories and finds the strongest echo', () => {
    const src = db
      .insert(sources)
      .values({ type: 'rss', name: 'test', config: '{}' })
      .returning()
      .get();
    const single = insertStory(db, { title: 'single-source', daysAgo: 1, coding: 80 });
    const multi = insertStory(db, { title: 'multi-source story', daysAgo: 1, coding: 80 });
    const now = new Date();
    db.insert(items).values([
      { sourceId: src.id, url: 'https://a.example/1', title: 'a', fetchedAt: now, storyId: single.id },
      { sourceId: src.id, url: 'https://a.example/2', title: 'b', fetchedAt: now, storyId: multi.id },
      { sourceId: src.id, url: 'https://a.example/3', title: 'c', fetchedAt: now, storyId: multi.id },
      { sourceId: src.id, url: 'https://a.example/4', title: 'd', fetchedAt: now, storyId: multi.id },
    ]).run();
    const echoes = echoStats();
    expect(echoes.multiSource).toBe(1);
    expect(echoes.strongest).toEqual({ title: 'multi-source story', sources: 3 });
  });
});

describe('sanitizers', () => {
  it('sanitizeEntities enforces shape, dedup, cap and kinds', () => {
    expect(sanitizeEntities(null)).toEqual([]);
    expect(sanitizeEntities('x')).toEqual([]);
    const out = sanitizeEntities([
      { name: 'GPT-5.2', kind: 'model' },
      { name: 'gpt-5.2', kind: 'model' }, // dup (case)
      { name: '  ', kind: 'model' }, // empty
      { name: 'Claude Code', kind: 'weird-kind' }, // kind falls back
      ...Array.from({ length: 10 }, (_, i) => ({ name: `E${i}`, kind: 'org' })),
    ]);
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ name: 'GPT-5.2', kind: 'model' });
    expect(out[1]).toEqual({ name: 'Claude Code', kind: 'model' });
  });

  it('sanitizeInsights enforces shape, direction fallback and cap', () => {
    expect(sanitizeInsights(undefined)).toEqual([]);
    const out = sanitizeInsights([
      { headline: 'Open-weights closing the gap', detail: 'Evidence.', direction: 'up', domain: 'coding' },
      { headline: 'Weird direction', detail: 'Evidence.', direction: 'sideways' },
      { headline: 'Bad domain', detail: 'Evidence.', direction: 'down', domain: 'nonsense' },
      { headline: '', detail: 'no headline' },
      ...Array.from({ length: 8 }, (_, i) => ({ headline: `H${i}`, detail: 'd', direction: 'watch' })),
    ]);
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({ direction: 'up', domain: 'coding' });
    expect(out[1].direction).toBe('watch');
    expect(out[2].domain).toBeUndefined();
  });
});
