/**
 * Board-shaped view for /decide/tools, assembled from two owners:
 *
 *   picks  -> kit_picks       (which tool wins each tier)
 *   verdict-> board_entries   (the written "why", runelabs_verdict)
 *
 * The verdict deliberately does NOT come from kit_picks.why. That column is
 * owned by the evidence feeder and is legitimately empty until Feeder B
 * attaches reports, whereas the board's verdict is written by applyProposal
 * (from the reviewed proposal rationale) or by a human in VerdictEditor —
 * both of which write board_entries. Reading `why` here meant the page showed
 * "add verdict" on 17 cells that already had one, and a human-written verdict
 * would never have appeared either, since the editor posts to board_entries.
 */
import { inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { boardEntries, kitPicks } from '../db/schema';
import { DOMAINS } from '../domains';
import { boardCellToKitCell } from './from-board';

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

  // board_entries keyed by KIT cell, so the avatar/talking-head -> avatar
  // rename lines the two tables up. VerdictEditor still posts to
  // board_entries.id, so the row id has to be the board's, not kit_picks'.
  const boardByCell = new Map<string, typeof boardEntries.$inferSelect>();
  for (const e of db.select().from(boardEntries).all()) {
    const cell = boardCellToKitCell(e.domain, e.task);
    if (cell) boardByCell.set(`${cell.category}/${cell.task}`, e);
  }

  const byCell = new Map<string, BoardRow>();
  for (const r of rows) {
    const key = `${r.category}/${r.task}`;
    let row = byCell.get(key);
    if (!row) {
      const entry = boardByCell.get(key);
      row = {
        domain: r.category,
        task: r.task,
        bestOverall: null,
        bestValue: null,
        cheapestViable: null,
        costNote: null,
        verdict: entry?.runelabsVerdict ?? null,
        updatedAt: null,
        id: entry?.id ?? r.id,
        verdictAuthor: entry?.verdictAuthor ?? null,
      };
      byCell.set(key, row);
    }
    if (r.tier === 'best') row.bestOverall = r.pickName;
    if (r.tier === 'value') row.bestValue = r.pickName;
    if (r.tier === 'cheapest') row.cheapestViable = r.pickName;
    row.costNote = row.costNote ?? r.priceNote ?? null;
    if (r.updatedAt && (!row.updatedAt || r.updatedAt > row.updatedAt)) row.updatedAt = r.updatedAt;
  }
  return [...byCell.values()].sort(
    (a, b) => a.domain.localeCompare(b.domain) || a.task.localeCompare(b.task),
  );
}
