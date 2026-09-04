import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { forecasts, metricPoints, stories } from '@/lib/db/schema';
import {
  accuracyMisses,
  calibrationBuckets,
  calibrationMonotonic,
  forecastGrades,
  gradingSince,
  pendingGrades,
  rescoreBacklog,
  spearman,
  type CalibrationBucket,
} from '@/lib/science/accuracy';
import { verdictSummary } from '@/lib/science/verdict-accuracy';
import { useTestDb } from './helpers/db';

function addGraded(db: ReturnType<typeof useTestDb>, topScore: number, hindsight: number, title?: string, at?: Date) {
  db.insert(stories)
    .values({
      title: title ?? `story ${topScore}/${hindsight}`,
      status: 'curated',
      topScore,
      hindsight,
      hindsightAt: at ?? new Date('2026-08-11T08:00:00Z'),
      createdAt: new Date(),
    })
    .run();
}

const bucket = (label: string, meanHindsight: number | null): CalibrationBucket => ({
  label,
  count: 5,
  meanScore: 50,
  meanHindsight,
  medianHindsight: meanHindsight,
  followThroughRate: 50,
  eligible: 5,
  coveragePct: 100,
});

describe('spearman', () => {
  it('1 for a perfect monotone relationship', () => {
    expect(spearman([10, 20, 30, 40], [1, 2, 3, 4])).toBeCloseTo(1);
  });

  it('-1 for a perfect inverse relationship', () => {
    expect(spearman([10, 20, 30, 40], [4, 3, 2, 1])).toBeCloseTo(-1);
  });

  it('handles ties with average ranks (zero-inflated hindsight)', () => {
    // scores rise while hindsight is mostly 0 — still a positive signal
    const rho = spearman([10, 20, 30, 40, 50], [0, 0, 0, 10, 20]);
    expect(rho).not.toBeNull();
    expect(rho!).toBeGreaterThan(0.8);
  });

  it('null when n<2 or one side is constant', () => {
    expect(spearman([50], [10])).toBeNull();
    expect(spearman([], [])).toBeNull();
    expect(spearman([50, 50, 50], [1, 2, 3])).toBeNull();
  });
});

describe('calibrationMonotonic', () => {
  it('true when band means rise with score', () => {
    expect(calibrationMonotonic([bucket('<40', 10), bucket('40–69', 25), bucket('70–100', 40)])).toBe(true);
  });

  it('false when inverted at the top', () => {
    expect(calibrationMonotonic([bucket('<40', 10), bucket('40–69', 25), bucket('70–100', 20)])).toBe(false);
  });

  it('false when any band has no data', () => {
    expect(calibrationMonotonic([bucket('<40', 10), bucket('40–69', null), bucket('70–100', 40)])).toBe(false);
  });
});

describe('calibrationBuckets', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('bands on feed thresholds (<40 / 40-69 / 70+) with median + mean + n', () => {
    const db = useTestDb();
    addGraded(db, 30, 5);
    addGraded(db, 45, 20);
    addGraded(db, 60, 30);
    addGraded(db, 70, 80);
    addGraded(db, 85, 10);
    addGraded(db, 95, 60);
    const buckets = calibrationBuckets();
    expect(buckets.map((b) => b.label)).toEqual(['<40', '40–69', '70–100']);
    expect(buckets[0].count).toBe(1);
    expect(buckets[1].count).toBe(2);
    expect(buckets[2].count).toBe(3);
    // 70+ band: hindsights [80, 10, 60] → median 60, mean 50
    expect(buckets[2].medianHindsight).toBe(60);
    expect(buckets[2].meanHindsight).toBe(50);
  });

  it('followThroughRate = % of the band with any hindsight at all', () => {
    const db = useTestDb();
    addGraded(db, 45, 0);
    addGraded(db, 50, 0);
    addGraded(db, 60, 25);
    const buckets = calibrationBuckets();
    // 40–69 band: 1 of 3 stories earned hindsight > 0 → 33%
    expect(buckets[1].followThroughRate).toBe(33);
    expect(buckets[0].followThroughRate).toBe(0);
  });

  it('ignores raw stories and ungraded rows', () => {
    const db = useTestDb();
    db.insert(stories).values({ title: 'raw', status: 'raw', topScore: 90, createdAt: new Date() }).run();
    db.insert(stories).values({ title: 'ungraded', status: 'curated', topScore: 90, createdAt: new Date() }).run();
    expect(calibrationBuckets().every((b) => b.count === 0)).toBe(true);
  });

  it('publishes coveragePct — graded ÷ old enough to grade — so missed stories cannot vanish', () => {
    const db = useTestDb();
    const old = new Date(Date.now() - 48 * 36e5); // inside the would-have-graded window
    // graded 70+ story
    db.insert(stories)
      .values({ title: 'graded old', status: 'curated', topScore: 80, hindsight: 40, hindsightAt: new Date(), createdAt: old })
      .run();
    // ungraded 70+ story of the same age — missed the rescore window
    db.insert(stories).values({ title: 'missed old', status: 'curated', topScore: 90, createdAt: old }).run();
    // fresh ungraded story — not yet eligible, must not hurt coverage
    db.insert(stories).values({ title: 'fresh', status: 'curated', topScore: 85, createdAt: new Date() }).run();

    const band = calibrationBuckets().find((b) => b.label === '70–100')!;
    expect(band.count).toBe(1);
    expect(band.eligible).toBe(2);
    expect(band.coveragePct).toBe(50); // the trust page marks bands below 90%
  });

  it('coveragePct is null when nothing in the band is old enough to grade', () => {
    const db = useTestDb();
    addGraded(db, 80, 20); // addGraded uses createdAt: now → not eligible
    expect(calibrationBuckets().find((b) => b.label === '70–100')!.coveragePct).toBeNull();
  });
});

describe('pendingGrades', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('counts ungraded curated stories still inside the 60h window', () => {
    const db = useTestDb();
    // fresh, ungraded → pending
    db.insert(stories)
      .values({ title: 'fresh', status: 'curated', topScore: 80, createdAt: new Date() })
      .run();
    // already graded → not pending
    addGraded(db, 80, 20);
    // stale ungraded (older than 60h, missed the rescore window) → not pending
    db.insert(stories)
      .values({
        title: 'stale',
        status: 'curated',
        topScore: 80,
        createdAt: new Date(Date.now() - 72 * 36e5),
      })
      .run();
    expect(pendingGrades()).toBe(1);
  });
});

describe('rescoreBacklog', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('counts curated stories that aged past the 60h window still ungraded', () => {
    const db = useTestDb();
    // missed the window → backlog
    db.insert(stories)
      .values({ title: 'stale', status: 'curated', topScore: 80, createdAt: new Date(Date.now() - 72 * 36e5) })
      .run();
    // in-window ungraded → pending, not backlog
    db.insert(stories)
      .values({ title: 'fresh', status: 'curated', topScore: 80, createdAt: new Date() })
      .run();
    // graded → neither
    addGraded(db, 80, 20);
    expect(rescoreBacklog()).toBe(1);
    expect(pendingGrades()).toBe(1);
  });
});

describe('forecastGrades', () => {
  beforeEach(() => {
    useTestDb();
  });

  const DAY = 864e5;
  const day = (agoDays: number) => new Date(Date.now() - agoDays * DAY).toISOString().slice(0, 10);

  function seedAa(dateStr: string, price: number) {
    getDb()
      .insert(metricPoints)
      .values([
        { source: 'aa', entity: 'frontier-model', metric: 'intelligence', value: 50, date: dateStr, createdAt: new Date() },
        { source: 'aa', entity: 'frontier-model', metric: 'price_blended', value: price, date: dateStr, createdAt: new Date() },
      ])
      .run();
  }

  function addForecast(date: string, predicted: number) {
    getDb().insert(forecasts).values({ date, metric: 'frontier_price_30d', predicted, createdAt: new Date() }).run();
  }

  it('symmetric log error: overshooting 2× and undershooting 2× score the same magnitude', () => {
    // realized price 8 at both 30d targets
    seedAa(day(31), 8);
    seedAa(day(0), 8);
    addForecast(day(61), 16); // predicted 2× too high → target day(31)
    addForecast(day(30), 4); // predicted 2× too low → target day(0)

    const grades = forecastGrades();
    const high = grades.find((g) => g.predicted === 16)!;
    const low = grades.find((g) => g.predicted === 4)!;
    // naive percent error gave −50% vs +100% — flattering on a falling price
    expect(high.errorPct).toBe(Math.round(Math.log(8 / 16) * 100)); // −69
    expect(low.errorPct).toBe(Math.round(Math.log(8 / 4) * 100)); // +69
    expect(Math.abs(high.errorPct!)).toBe(Math.abs(low.errorPct!));
  });

  it('discloses the date the realized value was actually read at', () => {
    seedAa(day(2), 8); // series point lags the exact target day(0) is absent
    addForecast(day(32), 10); // target = day(2)
    const [g] = forecastGrades();
    expect(g!.realized).toBe(8);
    expect(g!.realizedDate).toBe(day(2));
    expect(g!.errorPct).toBe(Math.round(Math.log(8 / 10) * 100));
  });

  it('is null-safe before the target date passes', () => {
    addForecast(day(1), 10); // target is 29 days in the future
    const [g] = forecastGrades();
    expect(g!.realized).toBeNull();
    expect(g!.realizedDate).toBeNull();
    expect(g!.errorPct).toBeNull();
  });
});

describe('accuracyMisses', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('over-rated = high score lowest hindsight; under-rated = low score highest hindsight', () => {
    const db = useTestDb();
    addGraded(db, 95, 5, 'hyped flop');
    addGraded(db, 90, 60, 'deserved hit');
    addGraded(db, 45, 90, 'quiet gem');
    addGraded(db, 50, 10, 'quiet dud');
    const { overRated, underRated } = accuracyMisses();
    expect(overRated[0].title).toBe('hyped flop');
    expect(underRated[0].title).toBe('quiet gem');
    expect(overRated.every((m) => m.topScore >= 70)).toBe(true);
    expect(underRated.every((m) => m.topScore < 60)).toBe(true);
  });

  it('caps at the limit', () => {
    const db = useTestDb();
    for (let i = 0; i < 8; i++) addGraded(db, 90, i, `f${i}`);
    expect(accuracyMisses(3).overRated).toHaveLength(3);
  });
});

describe('gradingSince', () => {
  it('returns the earliest hindsight date', () => {
    const db = useTestDb();
    addGraded(db, 50, 20, 'later', new Date('2026-08-12T08:00:00Z'));
    addGraded(db, 60, 30, 'earlier', new Date('2026-08-10T08:00:00Z'));
    expect(gradingSince()).toBe('2026-08-10');
  });
});

describe('verdictSummary', () => {
  beforeEach(() => useTestDb());

  it('returns every published verdict number with its denominator — null pct on n=0, never 0%', () => {
    const s = verdictSummary();
    expect(s.longevity).toMatchObject({
      medianHeldDays: null,
      closedFlips: 0,
      standingPct: null,
      standingDatable: 0,
      stillStanding: 0,
    });
    // was pct: 0 on all three — "0% n=0" read as a perfect record; null renders "—"
    expect(s.correction).toEqual({ corrections: 0, graded: 0, pct: null });
    expect(s.reversal).toEqual({ reversed: 0, cells: 0, pct: null });
    expect(s.coverage).toEqual({ registered: 0, open: 0, pct: null });
  });
});
