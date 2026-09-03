import { beforeEach, describe, expect, it } from 'vitest';
import { benchmarkSnapshots } from '@/lib/db/schema';
import { latestSnapshotsBySource, pruneBenchmarkSnapshots, SNAPSHOT_RETENTION_MS } from '@/lib/board/sync';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

const DAY = 864e5;

/** Snapshot rows run to a few KB in production — keep the test rows realistic. */
function seedSnapshots(db: Db, source: string, tag: (i: number) => string, ageDays: (i: number) => number, count: number) {
  for (let i = 0; i < count; i++) {
    db.insert(benchmarkSnapshots)
      .values({
        source,
        raw: `${tag(i)} ${'x'.repeat(1024)}`,
        fetchedAt: new Date(Date.now() - ageDays(i) * DAY),
      })
      .run();
  }
}

/**
 * 200 snapshots across 3 sources with mixed ages:
 * - aa-llm: 95 old (91-185d) + 5 fresh (0-4d), newest fresh is "aa-llm-fresh-0"
 * - aa-media-image: 50 rows, ALL old (100d+) — the source must drop out entirely
 * - openbench: 50 fresh (0-49d), newest is "openbench-fresh-0"
 */
function seedMixedSnapshots(db: Db) {
  seedSnapshots(
    db,
    'aa-llm',
    (i) => (i < 95 ? `aa-llm-old-${i}` : `aa-llm-fresh-${i - 95}`),
    (i) => (i < 95 ? 91 + i : i - 95),
    100,
  );
  seedSnapshots(db, 'aa-media-image', (i) => `media-old-${i}`, (i) => 100 + i, 50);
  seedSnapshots(db, 'openbench', (i) => `openbench-fresh-${i}`, (i) => i, 50);
}

describe('latestSnapshotsBySource — retention-bounded read', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    seedMixedSnapshots(db);
  });

  it('returns only the latest in-window snapshot per source', () => {
    const latest = latestSnapshotsBySource();
    expect([...latest.keys()].sort()).toEqual(['aa-llm', 'openbench']);
    expect(latest.get('aa-llm')!.startsWith('aa-llm-fresh-0 ')).toBe(true);
    expect(latest.get('openbench')!.startsWith('openbench-fresh-0 ')).toBe(true);
  });

  it('never surfaces an out-of-window row, even when it is the newest for its source', () => {
    const latest = latestSnapshotsBySource();
    // a source whose snapshots are all older than the window drops out entirely
    expect(latest.has('aa-media-image')).toBe(false);
    for (const raw of latest.values()) {
      expect(raw).not.toContain('-old-');
    }
  });
});

describe('pruneBenchmarkSnapshots', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    seedMixedSnapshots(db);
  });

  it('deletes only rows older than the retention window', () => {
    const removed = pruneBenchmarkSnapshots();
    expect(removed).toBe(145); // 95 old aa-llm + 50 old aa-media-image

    const remaining = db.select().from(benchmarkSnapshots).all();
    expect(remaining).toHaveLength(55);
    for (const row of remaining) {
      expect(Date.now() - row.fetchedAt.getTime()).toBeLessThan(SNAPSHOT_RETENTION_MS);
    }
  });

  it('is idempotent — a second prune removes nothing', () => {
    pruneBenchmarkSnapshots();
    expect(pruneBenchmarkSnapshots()).toBe(0);
  });
});
