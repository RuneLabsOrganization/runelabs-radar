import { beforeEach, describe, expect, it } from 'vitest';
import { metricPoints, stories } from '@/lib/db/schema';
import { hypeIndex } from '@/lib/science/hype';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

const DAY = 864e5;
const day = (ago: number): string => new Date(Date.now() - ago * DAY).toISOString().slice(0, 10);

/** N curated stories mentioning the entity once each (mentions_7d = n). */
function seedMentions(name: string, n: number): void {
  for (let i = 0; i < n; i++) {
    db.insert(stories)
      .values({
        title: `${name} story number ${i}`,
        tldr: 'tldr',
        status: 'curated',
        topScore: 70,
        entities: JSON.stringify([{ name, kind: 'model' }]),
        createdAt: new Date(),
      })
      .run();
  }
}

function seedSeries(entity: string, metric: string, points: { ago: number; value: number }[], source = 'github'): void {
  for (const p of points) {
    db.insert(metricPoints)
      .values({ source, entity, metric, value: p.value, date: day(p.ago), createdAt: new Date() })
      .run();
  }
}

describe('hypeIndex', () => {
  it('score = 100·mentions/(mentions + 3·log10(1+artifacts)) at a key point', () => {
    seedMentions('QuietBuilder', 10);
    // cumulative github stars 1000 → 1999 in the window: weekly delta 999
    seedSeries('acme/QuietBuilder', 'stars', [
      { ago: 5, value: 1000 },
      { ago: 1, value: 1999 },
    ]);

    const [entry] = hypeIndex();
    expect(entry!.name).toBe('QuietBuilder');
    expect(entry!.mentions).toBe(10);
    expect(entry!.artifacts).toBe(999);
    // log10(1+999) = 3 → 100·10 / (10 + 3·3)
    expect(entry!.score).toBe(Math.round(1000 / 19)); // 53
  });

  it('null — not max hype — when no artifact series matches the entity', () => {
    seedMentions('LoudModel', 5);
    seedSeries('someone/else', 'stars', [{ ago: 1, value: 42 }]);

    const [entry] = hypeIndex();
    expect(entry!.name).toBe('LoudModel');
    expect(entry!.mentions).toBe(5);
    expect(entry!.artifacts).toBe(0);
    expect(entry!.score).toBeNull(); // absence of data ≠ pure hype
  });

  it('a matched series with zero artifact movement scores 100 (pure hype)', () => {
    seedMentions('PureHype', 3);
    seedSeries('purehype', 'stars', [{ ago: 2, value: 500 }]); // no movement

    const [entry] = hypeIndex();
    expect(entry!.artifacts).toBe(0);
    expect(entry!.score).toBe(100);
  });

  it('sums weekly deltas of cumulative series with rate series (weekly_downloads counts directly)', () => {
    seedMentions('SumModel', 4);
    seedSeries('acme/SumModel', 'stars', [
      { ago: 6, value: 100 },
      { ago: 0, value: 199 },
    ]); // delta 99
    seedSeries('summodel', 'weekly_downloads', [{ ago: 1, value: 900 }], 'npm'); // rate: 900

    const [entry] = hypeIndex();
    expect(entry!.artifacts).toBe(999);
    // log10(1000) = 3 → 100·4 / (4 + 9)
    expect(entry!.score).toBe(Math.round(400 / 13)); // 31
  });

  it('ignores artifact series older than the 7d window', () => {
    seedMentions('StaleModel', 6);
    seedSeries('stalemodel', 'stars', [{ ago: 30, value: 9999 }]);

    const [entry] = hypeIndex();
    expect(entry!.score).toBeNull();
  });

  it('names shorter than 3 chars never match a series — null, not a false 100', () => {
    seedMentions('ab', 3);
    seedSeries('ab-corp', 'stars', [{ ago: 1, value: 1000 }]);

    const [entry] = hypeIndex();
    expect(entry!.name).toBe('ab');
    expect(entry!.score).toBeNull();
  });

  it('returns the top-mentioned entities, most-mentioned first, honoring the limit', () => {
    seedMentions('AlphaModel', 2);
    seedMentions('BetaModel', 8);
    seedMentions('GammaModel', 5);

    expect(hypeIndex(2).map((e) => e.name)).toEqual(['BetaModel', 'GammaModel']);
    expect(hypeIndex().map((e) => e.name)).toEqual(['BetaModel', 'GammaModel', 'AlphaModel']);
  });
});
