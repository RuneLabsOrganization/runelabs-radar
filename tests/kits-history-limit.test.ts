import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { kitPickHistory } from '@/lib/db/schema';
import { loadKitPickHistory } from '@/lib/kits/repo';

function row(category: string, task: string, toPick: string, hoursAgo: number) {
  return {
    category,
    task,
    tier: 'best' as const,
    fromPick: 'Old',
    toPick,
    reason: 'board proposal approved',
    changedAt: new Date(Date.now() - hoursAgo * 36e5),
  };
}

describe('loadKitPickHistory SQL pushdown', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('filters to exact (category, task) pairs — a bbox would leak lookalike cells', () => {
    db.insert(kitPickHistory)
      .values([
        row('video', 'dup', 'WantedCell', 2),
        row('audio', 'dup', 'BboxLeak', 1), // audio ∈ cats, dup ∈ tasks, pair not requested
        row('audio', 'other', 'AlsoWanted', 3),
      ])
      .run();

    const rows = loadKitPickHistory({
      days: 30,
      cells: [
        { category: 'video', task: 'dup' },
        { category: 'audio', task: 'other' },
      ],
    });
    expect(rows.map((r) => r.toPick)).toEqual(['WantedCell', 'AlsoWanted']);
  });

  it('applies the limit to the newest rows', () => {
    db.insert(kitPickHistory)
      .values([row('video', 'a', 'Newest', 1), row('video', 'a', 'Middle', 2), row('video', 'a', 'Oldest', 3)])
      .run();

    const rows = loadKitPickHistory({ days: 30, limit: 2 });
    expect(rows.map((r) => r.toPick)).toEqual(['Newest', 'Middle']);
  });

  it('caps an unbounded read at the default limit instead of scanning the whole window', () => {
    db.insert(kitPickHistory)
      .values(Array.from({ length: 60 }, (_, i) => row('video', 'a', `Pick${i}`, i + 1)))
      .run();

    const rows = loadKitPickHistory({ days: 30 });
    expect(rows).toHaveLength(50);
    expect(rows[0].toPick).toBe('Pick0'); // newest first survives the cap
  });

  it('returns the same page data as before for a normal seeded history', () => {
    db.insert(kitPickHistory)
      .values([row('video', 'a', 'New', 24), row('audio', 'b', 'First', 48)])
      .run();

    const rows = loadKitPickHistory({ days: 30, cells: [{ category: 'video', task: 'a' }, { category: 'audio', task: 'b' }] });
    expect(rows.map((r) => `${r.category}/${r.task}:${r.toPick}`)).toEqual(['video/a:New', 'audio/b:First']);
    expect(rows[0].fromPick).toBe('Old');
  });

  it('returns nothing for an empty cell set', () => {
    db.insert(kitPickHistory).values(row('video', 'a', 'New', 2)).run();
    expect(loadKitPickHistory({ days: 30, cells: [] })).toHaveLength(0);
  });
});
