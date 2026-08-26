import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import { kitPicks } from '@/lib/db/schema';
import { boardRows } from '@/lib/kits/board-view';

describe('board view over kit_picks', () => {
  beforeEach(() => {
    const db = useTestDb();
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
});
