import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { boardEntries, kitPicks } from '@/lib/db/schema';
import { boardRows } from '@/lib/kits/board-view';

describe('board view over kit_picks', () => {
  let db: Db;

  beforeEach(() => {
    db = useTestDb();
    db.insert(kitPicks)
      .values([
        { category: 'coding', task: 'autocomplete', tier: 'best', pickName: 'Alpha', updatedAt: new Date('2026-08-02') },
        { category: 'coding', task: 'autocomplete', tier: 'value', pickName: 'Beta', updatedAt: new Date('2026-08-05') },
        { category: 'infra', task: 'hosting', tier: 'best', pickName: 'Gamma', updatedAt: new Date('2026-08-05') },
      ])
      .run();
  });

  it('folds tiers into one row per cell', () => {
    const rows = boardRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].bestOverall).toBe('Alpha');
    expect(rows[0].bestValue).toBe('Beta');
    expect(rows[0].cheapestViable).toBeNull();
    expect(rows[0].updatedAt).toEqual(new Date('2026-08-05'));
  });

  it('omits categories outside the six story domains', () => {
    expect(boardRows().some((r) => r.domain === 'infra')).toBe(false);
  });

  // The regression: the verdict was being read from kit_picks.why, which the
  // evidence feeder owns and which is empty until Feeder B runs — so the page
  // showed "add verdict" on cells that already had one, and a human-written
  // verdict would never have surfaced either (VerdictEditor posts to
  // board_entries). Picks come from kit_picks; the written why comes from
  // board_entries. Two owners, and this is the seam.
  it('reads the verdict and its author from board_entries, not kit_picks.why', () => {
    db.insert(boardEntries)
      .values({
        domain: 'coding',
        task: 'autocomplete',
        runelabsVerdict: 'Alpha wins on inline latency.',
        verdictAuthor: 'Runelabs (auto)',
        updatedAt: new Date('2026-08-05'),
      })
      .run();

    const row = boardRows()[0];
    expect(row.verdict).toBe('Alpha wins on inline latency.');
    expect(row.verdictAuthor).toBe('Runelabs (auto)');
    expect(row.bestOverall).toBe('Alpha'); // picks still come from kit_picks
  });

  it('uses the board_entries row id so VerdictEditor posts to the right record', () => {
    const entryId = db
      .insert(boardEntries)
      .values({ domain: 'coding', task: 'autocomplete', updatedAt: new Date() })
      .returning()
      .get().id;

    expect(boardRows()[0].id).toBe(entryId);
  });

  // board_entries stores "avatar/talking-head"; kit_picks stores "avatar".
  // Without the rename map the two tables never line up and the verdict is lost.
  it('matches a cell across the avatar/talking-head rename', () => {
    db.insert(kitPicks)
      .values({ category: 'video', task: 'avatar', tier: 'best', pickName: 'Delta', updatedAt: new Date() })
      .run();
    db.insert(boardEntries)
      .values({
        domain: 'video',
        task: 'avatar/talking-head',
        runelabsVerdict: 'Delta syncs audio in one pass.',
        updatedAt: new Date(),
      })
      .run();

    const row = boardRows().find((r) => r.task === 'avatar')!;
    expect(row.verdict).toBe('Delta syncs audio in one pass.');
  });

  it('leaves the verdict null when no board row exists for the cell', () => {
    expect(boardRows()[0].verdict).toBeNull();
    expect(boardRows()[0].verdictAuthor).toBeNull();
  });
});
