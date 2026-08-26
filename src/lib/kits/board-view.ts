/**
 * Board-shaped view over kit_picks — the three tiers of one cell folded back
 * into a single row, so the existing /decide/tools table renders unchanged
 * while kit_picks stays the single source of truth.
 */
import { inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { kitPicks } from '../db/schema';
import { DOMAINS } from '../domains';

export interface BoardRow {
  domain: string;
  task: string;
  bestOverall: string | null;
  bestValue: string | null;
  cheapestViable: string | null;
  costNote: string | null;
  verdict: string | null;
  updatedAt: Date | null;
  /** First kit_picks id seen for this cell — React key. VerdictEditor still posts to board_entries. */
  id: number;
  verdictAuthor: string | null;
}

/** Only the six story domains appear on the board; audio/infra/connectors live on /decide/kits. */
export function boardRows(): BoardRow[] {
  const db = getDb();
  const rows = db
    .select()
    .from(kitPicks)
    .where(inArray(kitPicks.category, [...DOMAINS]))
    .all();

  const byCell = new Map<string, BoardRow>();
  for (const r of rows) {
    const key = `${r.category}/${r.task}`;
    let row = byCell.get(key);
    if (!row) {
      row = {
        domain: r.category,
        task: r.task,
        bestOverall: null,
        bestValue: null,
        cheapestViable: null,
        costNote: null,
        verdict: null,
        updatedAt: null,
        id: r.id,
        verdictAuthor: null,
      };
      byCell.set(key, row);
    }
    if (r.tier === 'best') row.bestOverall = r.pickName;
    if (r.tier === 'value') row.bestValue = r.pickName;
    if (r.tier === 'cheapest') row.cheapestViable = r.pickName;
    row.costNote = row.costNote ?? r.priceNote ?? null;
    row.verdict = row.verdict ?? r.why ?? null;
    if (r.updatedAt && (!row.updatedAt || r.updatedAt > row.updatedAt)) row.updatedAt = r.updatedAt;
  }
  return [...byCell.values()].sort(
    (a, b) => a.domain.localeCompare(b.domain) || a.task.localeCompare(b.task),
  );
}
