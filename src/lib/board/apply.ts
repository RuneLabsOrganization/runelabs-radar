import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { boardEntries, boardHistory, boardProposals, kitPickHistory, kitPicks } from '../db/schema';
import { buildClaim } from '../kits/claims';
import { closeOpenClaim, openClaim } from '../kits/claims-repo';
import { boardCellToKitCell, TIER_BY_FIELD, type BoardField } from '../kits/from-board';

const FIELDS = ['bestOverall', 'bestValue', 'cheapestViable', 'costNote'] as const;
type Field = (typeof FIELDS)[number];
type ProposedFields = Record<Field, string | null>;

/** Marks a verdict as machine-written so automation knows it's still free to refresh it. */
export const AUTO_VERDICT_AUTHOR = 'Runelabs (auto)';

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
function mirrorToKitPicks(
  domain: string,
  task: string,
  proposed: ProposedFields,
  now: Date,
  reason: string,
): void {
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

    const pickChanged = existing?.pickName !== pickName;
    const noteRefresh = proposed.costNote !== null && proposed.costNote !== existing?.priceNote;
    if (!pickChanged && !noteRefresh) continue;

    // Board apply only writes non-null fields — a missing costNote must not
    // wipe an existing kit priceNote the same way it would not wipe board costNote.
    const set: { pickName?: string; priceNote?: string; updatedAt: Date } = { updatedAt: now };
    if (pickChanged) set.pickName = pickName;
    if (proposed.costNote !== null) set.priceNote = proposed.costNote;

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
        set,
      })
      .run();

    if (!pickChanged) continue; // costNote-only refresh — no history row

    db.insert(kitPickHistory)
      .values({
        category: cell.category,
        task: cell.task,
        tier,
        fromPick: existing?.pickName ?? null,
        toPick: pickName,
        reason: reason.trim() || 'board proposal approved',
        changedAt: now,
      })
      .run();

    // A pick change ends the previous claim and opens a new one. The falsifier
    // stays unregistered until a reviewer states one — coverage is reported
    // rather than faked (see src/lib/kits/claims.ts).
    const claimCell = { category: cell.category, task: cell.task, tier };
    closeOpenClaim(claimCell, now);
    openClaim(buildClaim({ ...claimCell, pickName, openedAt: now }));
  }
}

/**
 * Applies a pending proposal: upserts board_entries by (domain, task) with the
 * four proposed fields, appends a human-readable board_history row, and marks
 * the proposal approved. Missing/non-pending proposals → {ok:false}.
 *
 * The whole apply runs in one transaction and the status flip IS the lock:
 * the conditional UPDATE ... WHERE status='pending' is atomic across the
 * web/worker/mcp processes sharing the SQLite file, so a double-clicked or
 * concurrently approved proposal applies exactly once (one board_history row,
 * one kit_pick_history row, one verdict claim). The claim goes first because
 * a transaction whose first statement is a write takes the write lock
 * immediately (busy_timeout) instead of failing a read-then-write upgrade
 * with SQLITE_BUSY_SNAPSHOT.
 */
export async function applyProposal(proposalId: number): Promise<{ ok: boolean }> {
  const db = getDb();
  return db.transaction((tx) => {
    const claimed = tx
      .update(boardProposals)
      .set({ status: 'approved' })
      .where(and(eq(boardProposals.id, proposalId), eq(boardProposals.status, 'pending')))
      .run();
    if (claimed.changes === 0) return { ok: false };
    // changes === 1 implies the row exists — we just wrote it.
    const proposal = tx.select().from(boardProposals).where(eq(boardProposals.id, proposalId)).get()!;

    const proposed = parseProposed(proposal.proposed);
    const existing = tx
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

    // The rationale was already shown to the human in ProposalCard before they
    // approved this — it's reviewed content, not a fresh assertion. Auto-fill
    // or refresh the board's verdict from it, but only while no human has
    // hand-written their own via the VerdictEditor: once verdict_author is a
    // real name, automation must never overwrite deliberate human prose. This
    // also keeps the verdict in sync with the pick on every later approval —
    // leaving it fill-once-then-never-touch-again would let a verdict describe
    // a tool the board no longer picks, the exact mismatch a stale verdict
    // caused once already.
    const verdictClaimed = existing?.verdictAuthor != null && existing.verdictAuthor !== AUTO_VERDICT_AUTHOR;
    const verdictPatch = verdictClaimed
      ? {}
      : { runelabsVerdict: proposal.rationale, verdictAuthor: AUTO_VERDICT_AUTHOR };

    tx.insert(boardEntries)
      .values({ domain: proposal.domain, task: proposal.task, ...changes, ...verdictPatch, updatedAt: now })
      .onConflictDoUpdate({
        target: [boardEntries.domain, boardEntries.task],
        set: { ...changes, ...verdictPatch, updatedAt: now },
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
    tx.insert(boardHistory)
      .values({ domain: proposal.domain, task: proposal.task, change, appliedAt: now })
      .run();

    // mirrorToKitPicks and the claim repo write via getDb() — the same
    // connection this transaction is on, so those writes join it.
    mirrorToKitPicks(proposal.domain, proposal.task, proposed, now, proposal.rationale);

    return { ok: true };
  });
}

/** Rejects a pending proposal (status flip only). Missing/non-pending → {ok:false}. */
export async function rejectProposal(proposalId: number): Promise<{ ok: boolean }> {
  const db = getDb();
  const proposal = db.select().from(boardProposals).where(eq(boardProposals.id, proposalId)).get();
  if (!proposal || proposal.status !== 'pending') return { ok: false };
  db.update(boardProposals).set({ status: 'rejected' }).where(eq(boardProposals.id, proposalId)).run();
  return { ok: true };
}
