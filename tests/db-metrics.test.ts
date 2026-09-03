import { describe, expect, it } from 'vitest';
import { useTestDb } from './helpers/db';
import { recordMetrics, seriesFor, upsertMetric, utcDay } from '@/lib/metrics';
import { metricPoints } from '@/lib/db/schema';

describe('recordMetrics batch write', () => {
  it('produces the same final state as sequential upserts', () => {
    const db = useTestDb();
    const today = utcDay();

    const n = recordMetrics([
      { source: 'aa', entity: 'm1', metric: 'elo', value: 1000 },
      { source: 'aa', entity: 'm1', metric: 'elo', value: 1010 }, // same key — last write wins
      { source: 'aa', entity: 'm2', metric: 'elo', value: 900 },
      { source: 'aa', entity: 'm3', metric: 'elo', value: NaN }, // skipped
      { source: 'aa', entity: 'm2', metric: 'intelligence', value: 50, date: '2026-01-01' },
    ]);

    expect(n).toBe(4);
    expect(db.select().from(metricPoints).all()).toHaveLength(3);
    expect(seriesFor('aa', 'm1', 'elo')).toEqual([{ date: today, value: 1010 }]);
    expect(seriesFor('aa', 'm2', 'elo')).toEqual([{ date: today, value: 900 }]);
    expect(seriesFor('aa', 'm2', 'intelligence', 400)).toEqual([{ date: '2026-01-01', value: 50 }]);
    expect(seriesFor('aa', 'm3', 'elo')).toEqual([]);
  });

  it('stays idempotent across re-runs of the same batch', () => {
    const db = useTestDb();
    const batch = [
      { source: 'gh', entity: 'org/repo', metric: 'stars', value: 10 },
      { source: 'gh', entity: 'org/repo2', metric: 'stars', value: 20 },
    ];
    expect(recordMetrics(batch)).toBe(2);
    expect(recordMetrics(batch)).toBe(2);
    expect(db.select().from(metricPoints).all()).toHaveLength(2);
  });

  it('upsertMetric is unchanged for single-row callers', () => {
    useTestDb();
    upsertMetric({ source: 's', entity: 'e', metric: 'm', value: 1 });
    upsertMetric({ source: 's', entity: 'e', metric: 'm', value: 2 });
    expect(seriesFor('s', 'e', 'm')).toEqual([{ date: utcDay(), value: 2 }]);
  });
});
