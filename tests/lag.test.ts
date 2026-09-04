import { beforeEach, describe, expect, it } from 'vitest';
import { metricPoints } from '@/lib/db/schema';
import { makeRng } from '@/lib/science/math';
import { LAG_MIN_DAYS, lagFindings, lagReadiness } from '@/lib/science/lag';
import { utcDay } from '@/lib/metrics';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

/** Seed daily launch counts; `values[i]` is i days ago. Missing indices = no row (a real gap). */
function seedSeries(entity: string, values: (number | null)[]): void {
  values.forEach((count, daysAgo) => {
    if (count === null) return;
    db.insert(metricPoints)
      .values({
        source: 'launches',
        entity,
        metric: 'count',
        value: count,
        date: utcDay(new Date(Date.now() - daysAgo * 864e5)),
        createdAt: new Date(),
      })
      .run();
  });
}

const DAYS = 30;
const randomSeries = (seed: number): number[] => {
  const rng = makeRng(seed);
  return Array.from({ length: DAYS }, () => Math.floor(rng() * 7));
};

describe('lagFindings', () => {
  it('readiness now requires enough days for a fixed-window coefficient', () => {
    expect(lagReadiness().ready).toBe(false);
    expect(LAG_MIN_DAYS).toBe(24); // maxLag 10 + minimum overlap 14
  });

  it('publishes NOTHING for independent random series (best-of-11 used to pass r≥0.4)', () => {
    // regression: 11 lags × ~21 points with no significance test meant some
    // lag almost always "correlated". Now Fisher z + Bonferroni over 11 lags
    // × 2 directions gates publication.
    seedSeries('ai-media', randomSeries(5));
    seedSeries('ai-content', randomSeries(9));
    seedSeries('agents', randomSeries(13));
    seedSeries('saas-tools', randomSeries(17));
    expect(lagFindings()).toEqual([]);
  });

  it('still detects a planted 3-day lag, reporting n and the threshold it cleared', () => {
    const media = randomSeries(21);
    // content on day X = media on day X−3 (content FOLLOWS media). In seed
    // indexing (i = days ago) that is content[i] = media[i+3]:
    const content = [...media.slice(3), 0, 0, 0];
    seedSeries('ai-media', media);
    seedSeries('ai-content', content);
    const findings = lagFindings();
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.leader).toBe('ai-media launches');
    expect(f.follower).toBe('ai-content launches');
    expect(f.lagDays).toBe(3);
    expect(f.n).toBe(DAYS - 10); // fixed window: shared days − maxLag
    expect(f.coefficient).toBeGreaterThan(f.threshold);
    expect(f.threshold).toBeGreaterThan(0.4); // far above the old naive bar
  });

  it('tests the reverse direction too — the leader is not assumed', () => {
    const content = randomSeries(33);
    // media on day X = content on day X−4 (MEDIA follows CONTENT by 4)
    const media = [...content.slice(4), 0, 0, 0, 0];
    seedSeries('ai-media', media);
    seedSeries('ai-content', content);
    const findings = lagFindings();
    expect(findings).toHaveLength(1);
    expect(findings[0]!.leader).toBe('ai-content launches');
    expect(findings[0]!.follower).toBe('ai-media launches');
    expect(findings[0]!.lagDays).toBe(4);
  });

  it('gap days do not fabricate a correlation (inner join, no zero-fill)', () => {
    // media exists for the most recent 20 days, content for 20 days ending
    // 14 days ago — only 6 shared days. Zero-filling the union (34 days)
    // used to align long synchronized zero-runs into a fake dip-and-recover
    // correlation; with an inner join the overlap is below the 14-point
    // minimum and nothing is published.
    const media: (number | null)[] = Array.from({ length: 34 }, (_, i) => (i < 20 ? 5 + (i % 3) : null));
    const content: (number | null)[] = Array.from({ length: 34 }, (_, i) => (i >= 14 ? 5 + (i % 3) : null));
    seedSeries('ai-media', media);
    seedSeries('ai-content', content);
    expect(lagReadiness().ready).toBe(true); // plenty of raw history…
    expect(lagFindings()).toEqual([]); // …but not enough SHARED days
  });
});
