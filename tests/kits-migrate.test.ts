import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { boardEntries, kitPicks } from '@/lib/db/schema';
import { migrateBoardToKits } from '@/lib/kits/migrate-board';

describe('board_entries -> kit_picks', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('creates one pick per non-null tier', () => {
    db.insert(boardEntries)
      .values({
        domain: 'coding',
        task: 'agentic-coding',
        bestOverall: 'Alpha',
        bestValue: 'Beta',
        cheapestViable: null,
        costNote: 'a note',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      })
      .run();

    const n = migrateBoardToKits();

    expect(n).toBe(2);
    const rows = db.select().from(kitPicks).all();
    expect(rows.map((r) => `${r.tier}:${r.pickName}`).sort()).toEqual(['best:Alpha', 'value:Beta']);
    expect(rows.every((r) => r.priceNote === 'a note')).toBe(true);
    expect(rows.every((r) => r.confidence === 'low')).toBe(true);
  });

  it('renames avatar/talking-head to avatar', () => {
    db.insert(boardEntries)
      .values({
        domain: 'video',
        task: 'avatar/talking-head',
        bestOverall: 'Alpha',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
      })
      .run();
    migrateBoardToKits();
    expect(db.select().from(kitPicks).all()[0].task).toBe('avatar');
  });

  it('skips rows whose cell is not in the grid', () => {
    db.insert(boardEntries)
      .values({ domain: 'coding', task: 'not-a-real-task', bestOverall: 'Alpha', updatedAt: new Date() })
      .run();
    expect(migrateBoardToKits()).toBe(0);
  });

  it('is idempotent', () => {
    db.insert(boardEntries)
      .values({ domain: 'coding', task: 'autocomplete', bestOverall: 'Alpha', updatedAt: new Date() })
      .run();
    migrateBoardToKits();
    migrateBoardToKits();
    expect(db.select().from(kitPicks).all()).toHaveLength(1);
  });

  it('does nothing when every board pick is null', () => {
    db.insert(boardEntries)
      .values({ domain: 'copy', task: 'social', updatedAt: new Date() })
      .run();
    expect(migrateBoardToKits()).toBe(0);
    expect(db.select().from(kitPicks).all()).toHaveLength(0);
  });
});
