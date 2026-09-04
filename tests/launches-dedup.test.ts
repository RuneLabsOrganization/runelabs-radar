import { beforeEach, describe, expect, it } from 'vitest';
import { launches } from '@/lib/db/schema';
import { recordDailyCounts } from '@/lib/launches';
import { seriesFor, utcDay } from '@/lib/metrics';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

function insertLaunch(
  title: string,
  source: 'show-hn' | 'producthunt',
  category: string,
  launchedAt: Date = new Date(),
): void {
  db.insert(launches)
    .values({
      source,
      title,
      // urls differ per row (the launches table keys on url uniqueness)
      url: `https://example.com/${source}/${Math.random().toString(36).slice(2)}`,
      points: 10,
      comments: 2,
      category,
      launchedAt,
      createdAt: new Date(),
    })
    .run();
}

/** Total counted for a category across the covered days (midnight-straddle-safe). */
function totalCounted(category: string): number {
  return seriesFor('launches', category, 'count', 3).reduce((s, p) => s + p.value, 0);
}

describe('recordDailyCounts cross-source dedup (E12)', () => {
  it('the same product on Show HN AND Product Hunt counts once', () => {
    insertLaunch('Acme AI writer', 'show-hn', 'ai-content', new Date(Date.now() - 36e5));
    // same normalized title, different source, 6h earlier → same launch
    insertLaunch('Acme AI writer', 'producthunt', 'ai-content', new Date(Date.now() - 7 * 36e5));

    recordDailyCounts();

    expect(totalCounted('ai-content')).toBe(1);
  });

  it('title normalization applies: punctuation and case still match', () => {
    insertLaunch('Acme: AI Writer!', 'show-hn', 'ai-content', new Date(Date.now() - 36e5));
    insertLaunch('acme ai writer', 'producthunt', 'ai-content', new Date(Date.now() - 2 * 36e5));

    recordDailyCounts();

    expect(totalCounted('ai-content')).toBe(1);
  });

  it('distinct products keep their counts', () => {
    insertLaunch('Acme AI writer', 'show-hn', 'ai-content', new Date());
    insertLaunch('Beta video generator', 'producthunt', 'ai-content', new Date());

    recordDailyCounts();

    expect(totalCounted('ai-content')).toBe(2);
  });

  it('the same title on the SAME source is not deduped (a repost is its own launch)', () => {
    insertLaunch('Acme AI writer', 'show-hn', 'ai-content', new Date());
    insertLaunch('Acme AI writer', 'show-hn', 'ai-content', new Date(Date.now() - 2 * 36e5));

    recordDailyCounts();

    expect(totalCounted('ai-content')).toBe(2);
  });

  it('same product more than ±1 day apart counts as separate launches', () => {
    const now = new Date();
    insertLaunch('Acme AI writer', 'show-hn', 'ai-content', now);
    insertLaunch('Acme AI writer', 'producthunt', 'ai-content', new Date(now.getTime() - 30 * 36e5));

    recordDailyCounts();

    const today = utcDay(now);
    const yesterday = utcDay(new Date(now.getTime() - 30 * 36e5));
    const series = seriesFor('launches', 'ai-content', 'count', 3);
    expect(series).toContainEqual({ date: today, value: 1 });
    expect(series).toContainEqual({ date: yesterday, value: 1 });
  });
});
