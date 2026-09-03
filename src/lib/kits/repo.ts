/**
 * Database reads for kits. The only impure module under src/lib/kits — the
 * grid, roster, grader and composer stay pure so the invariants are cheap to
 * test.
 */
import { and, desc, eq, gt, inArray, or } from 'drizzle-orm';
import { getDb } from '../db';
import { kitPickHistory, kitPicks } from '../db/schema';
import { composeKit, type Kit, type PickRecord } from './compose';
import type { KitCell, KitTier } from './grid';
import type { KitPersona } from './personas';

type Row = typeof kitPicks.$inferSelect;

function toRecord(row: Row): PickRecord {
  return {
    category: row.category,
    task: row.task,
    tier: row.tier,
    pickName: row.pickName,
    pickUrl: row.pickUrl ?? null,
    priceModel: row.priceModel,
    priceUsdMonth: row.priceUsdMonth ?? null,
    priceNote: row.priceNote ?? null,
    riskFlag: row.riskFlag ?? null,
    why: row.why ?? null,
    skip: row.skip ?? null,
    confidence: row.confidence,
    evidenceCount: row.evidenceCount,
    verifiedAt: row.verifiedAt ?? null,
  };
}

/** Picks for the given cells at one tier. Cells with no row are simply absent. */
export function loadPicks(cells: KitCell[] | { category: string; task: string }[], tier: KitTier): PickRecord[] {
  if (cells.length === 0) return [];
  const db = getDb();
  const tasks = [...new Set(cells.map((c) => c.task))];
  const categories = [...new Set(cells.map((c) => c.category))];
  const wanted = new Set(cells.map((c) => `${c.category}/${c.task}`));
  // One query over the (category, task) bounding box, then filter to the exact
  // pairs — cheaper than N queries and correct for sparse route sets.
  return db
    .select()
    .from(kitPicks)
    .where(
      and(
        eq(kitPicks.tier, tier),
        inArray(kitPicks.category, categories),
        inArray(kitPicks.task, tasks),
      ),
    )
    .all()
    .filter((r) => wanted.has(`${r.category}/${r.task}`))
    .map(toRecord);
}

export function getPickCell(category: string, task: string, tier: KitTier): PickRecord | null {
  const db = getDb();
  const row = db
    .select()
    .from(kitPicks)
    .where(and(eq(kitPicks.category, category), eq(kitPicks.task, task), eq(kitPicks.tier, tier)))
    .get();
  return row ? toRecord(row) : null;
}

/** The full read path: persona + tier -> costed kit. */
export function loadKit(persona: KitPersona, tier: KitTier, exclude?: string[]): Kit {
  const picks = loadPicks(persona.routes, tier);
  return composeKit(persona, tier, picks, { exclude });
}

export type KitPickChange = typeof kitPickHistory.$inferSelect;

/** kit_pick_history is append-forever and read on every kit page render — cap the window read. */
const DEFAULT_HISTORY_LIMIT = 50;

/**
 * Recent pick changes, newest first. Same shape as the whats_changed MCP
 * query: gt(changedAt, now − days), optional cell filter, then limit — all in
 * SQL, never a fetch-the-window-then-slice pass over an append-forever table.
 */
export function loadKitPickHistory(opts: {
  days: number;
  cells?: { category: string; task: string }[] | null;
  limit?: number;
}): KitPickChange[] {
  const since = new Date(Date.now() - opts.days * 24 * 36e5);
  if (opts.cells && opts.cells.length === 0) return [];
  // Exact (category, task) pairs in the WHERE — a bounding-box filter would
  // let out-of-cell rows eat the LIMIT ahead of the rows the page wants.
  const cellFilter = opts.cells?.length
    ? or(...opts.cells.map((c) => and(eq(kitPickHistory.category, c.category), eq(kitPickHistory.task, c.task))))
    : undefined;
  return getDb()
    .select()
    .from(kitPickHistory)
    .where(and(gt(kitPickHistory.changedAt, since), cellFilter))
    .orderBy(desc(kitPickHistory.changedAt), desc(kitPickHistory.id))
    .limit(opts.limit ?? DEFAULT_HISTORY_LIMIT)
    .all();
}
