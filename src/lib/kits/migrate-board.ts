/**
 * One-shot backfill: board_entries -> kit_picks.
 *
 * board_entries flattened three tiers into columns with a single shared
 * cost_note and no evidence, so everything it carries lands at low confidence
 * with no verifiedAt — it has never been evidence-graded. Idempotent: an
 * existing cell+tier row is left alone.
 */
import { getDb } from '../db';
import { boardEntries, kitPicks } from '../db/schema';
import { isKitCell, type KitTier } from './grid';

/** board_entries task names that differ from the kit grid. */
export const TASK_RENAMES: Record<string, string> = {
  'avatar/talking-head': 'avatar',
};

const TIER_COLUMNS: Array<{ tier: KitTier; column: 'bestOverall' | 'bestValue' | 'cheapestViable' }> = [
  { tier: 'best', column: 'bestOverall' },
  { tier: 'value', column: 'bestValue' },
  { tier: 'cheapest', column: 'cheapestViable' },
];

/** Returns the number of kit_picks rows created. */
export function migrateBoardToKits(): number {
  const db = getDb();
  const entries = db.select().from(boardEntries).all();
  const existing = new Set(
    db
      .select()
      .from(kitPicks)
      .all()
      .map((r) => `${r.category}/${r.task}/${r.tier}`),
  );

  let created = 0;
  for (const entry of entries) {
    const category = entry.domain;
    const task = TASK_RENAMES[entry.task] ?? entry.task;
    if (!isKitCell(category, task)) continue;

    for (const { tier, column } of TIER_COLUMNS) {
      const pickName = entry[column];
      if (!pickName) continue;
      const key = `${category}/${task}/${tier}`;
      if (existing.has(key)) continue;

      db.insert(kitPicks)
        .values({
          category,
          task,
          tier,
          pickName,
          priceModel: 'seat',
          priceNote: entry.costNote ?? null,
          why: entry.runelabsVerdict ?? null,
          confidence: 'low',
          evidenceCount: 0,
          distinctSources: 0,
          verifiedAt: null,
          updatedAt: entry.updatedAt ?? new Date(),
        })
        .run();
      existing.add(key);
      created += 1;
    }
  }
  return created;
}
