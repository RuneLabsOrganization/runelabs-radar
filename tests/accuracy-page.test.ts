import { beforeEach, describe, expect, it } from 'vitest';
import { stories } from '@/lib/db/schema';
import {
  accuracyMisses,
  calibrationBuckets,
  calibrationMonotonic,
  gradingSince,
  type CalibrationBucket,
} from '@/lib/science/accuracy';
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

  it('ignores raw stories and ungraded rows', () => {
    const db = useTestDb();
    db.insert(stories).values({ title: 'raw', status: 'raw', topScore: 90, createdAt: new Date() }).run();
    db.insert(stories).values({ title: 'ungraded', status: 'curated', topScore: 90, createdAt: new Date() }).run();
    expect(calibrationBuckets().every((b) => b.count === 0)).toBe(true);
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
