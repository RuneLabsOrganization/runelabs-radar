import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { boardEntries, boardHistory, boardProposals, kitPickHistory, kitPicks } from '../db/schema';
import { boardCellToKitCell, TIER_BY_FIELD, type BoardField } from '../kits/from-board';

const FIELDS = ['bestOverall', 'bestValue', 'cheapestViable', 'costNote'] as const;
type Field = (typeof FIELDS)[number];
type ProposedFields = Record<Field, string | null>;

function parseProposed(json: string): ProposedFields {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null) raw = parsed as Record<string, unknown>;
  } catch {
    // malformed proposed JSON → treat every field as unset
  }
  const pick = (k: Field): string | null => {
    const v = raw[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };
  return {
    bestOverall: pick('bestOverall'),
    bestValue: pick('bestValue'),
    cheapestViable: pick('cheapestViable'),
    costNote: pick('costNote'),
  };
}

/**
 * Mirror an approved board proposal into kit_picks.
 *
 * The board is the human-gated source of truth for WHICH tool wins; the
 * pricing feeders own what it costs and the evidence feeder owns why. So this
 * writes pickName only and never touches priceUsdMonth, confidence or
 * evidence_count — clobbering those from a board cost note is how a kit ends
 * up asserting a number nobody verified.
 */
function mirrorToKitPicks(domain: string, task: string, proposed: ProposedFields, now: Date): void {
  const cell = boardCellToKitCell(domain, task);
  if (!cell) return; // board task with no kit cell (e.g. a retired task) — board write still stands

  const db = getDb();
  for (const [field, tier] of Object.entries(TIER_BY_FIELD) as [BoardField, 'best' | 'value' | 'cheapest'][]) {
    const pickName = proposed[field];
    if (pickName === null) continue;

    const existing = db
      .select()
      .from(kitPicks)
      .where(
        and(eq(kitPicks.category, cell.category), eq(kitPicks.task, cell.task), eq(kitPicks.tier, tier)),
      )
      .get();

    if (existing?.pickName === pickName) continue; // unchanged — no write, no history

    db.insert(kitPicks)
      .values({
        category: cell.category,
        task: cell.task,
        tier,
        pickName,
        priceNote: proposed.costNote,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [kitPicks.category, kitPicks.task, kitPicks.tier],
        // deliberately NOT setting price/confidence/evidence — other feeders own those
        set: { pickName, priceNote: proposed.costNote, updatedAt: now },
      })
      .run();

    db.insert(kitPickHistory)
      .values({
        category: cell.category,
        task: cell.task,
        tier,
        fromPick: existing?.pickName ?? null,
        toPick: pickName,
        reason: 'board proposal approved',
        changedAt: now,
      })
      .run();
  }
}

/**
 * Applies a pending proposal: upserts board_entries by (domain, task) with the
 * four proposed fields, appends a human-readable board_history row, and marks
 * the proposal approved. Missing/non-pending proposals → {ok:false}.
 */
export async function applyProposal(proposalId: number): Promise<{ ok: boolean }> {
  const db = getDb();
  const proposal = db.select().from(boardProposals).where(eq(boardProposals.id, proposalId)).get();
  if (!proposal || proposal.status !== 'pending') return { ok: false };

  const proposed = parseProposed(proposal.proposed);
  const existing = db
    .select()
    .from(boardEntries)
    .where(and(eq(boardEntries.domain, proposal.domain), eq(boardEntries.task, proposal.task)))
    .get();

  const now = new Date();
  // Only non-null proposed fields are applied — a partial proposal must never
  // wipe curated values it didn't mention.
  const changes: Partial<ProposedFields> = {};
  for (const f of FIELDS) {
    if (proposed[f] !== null) changes[f] = proposed[f];
  }
  db.insert(boardEntries)
    .values({ domain: proposal.domain, task: proposal.task, ...changes, updatedAt: now })
    .onConflictDoUpdate({
      target: [boardEntries.domain, boardEntries.task],
      set: { ...changes, updatedAt: now },
    })
    .run();

  const wasEmpty = !existing || FIELDS.every((f) => existing[f] === null);
  let change: string;
  if (wasEmpty) {
    change = 'initial values set';
  } else {
    const diffs = FIELDS.filter((f) => proposed[f] !== null && existing[f] !== proposed[f]).map(
      (f) => `${f}: ${existing[f] ?? '(none)'} -> ${proposed[f]}`,
    );
    change = diffs.length > 0 ? diffs.join('; ') : 'no field changes';
  }
  db.insert(boardHistory)
    .values({ domain: proposal.domain, task: proposal.task, change, appliedAt: now })
    .run();

  mirrorToKitPicks(proposal.domain, proposal.task, proposed, now);

  db.update(boardProposals).set({ status: 'approved' }).where(eq(boardProposals.id, proposalId)).run();
  return { ok: true };
}

/** Rejects a pending proposal (status flip only). Missing/non-pending → {ok:false}. */
export async function rejectProposal(proposalId: number): Promise<{ ok: boolean }> {
  const db = getDb();
  const proposal = db.select().from(boardProposals).where(eq(boardProposals.id, proposalId)).get();
  if (!proposal || proposal.status !== 'pending') return { ok: false };
  db.update(boardProposals).set({ status: 'rejected' }).where(eq(boardProposals.id, proposalId)).run();
  return { ok: true };
}
