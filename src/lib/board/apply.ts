import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { boardEntries, boardHistory, boardProposals, kitPickHistory, kitPicks } from '../db/schema';
import { buildClaim, normalizeFalsifier } from '../kits/claims';
import { closeOpenClaim, openClaim } from '../kits/claims-repo';
import { boardCellToKitCell, TIER_BY_FIELD, type BoardField } from '../kits/from-board';
import { decidePickChange, samePick, storyEvidenceSince, type DampingPolicy } from './damping';

const FIELDS = ['bestOverall', 'bestValue', 'cheapestViable', 'costNote'] as const;
const PICK_FIELDS = Object.keys(TIER_BY_FIELD) as BoardField[];
type Field = (typeof FIELDS)[number];
type ProposedFields = Record<Field, string | null>;
/** Per-tier falsifiers the proposal generator stated alongside its picks. */
export type ProposedFalsifiers = Partial<Record<BoardField, string>>;

/** Marks a verdict as machine-written so automation knows it's still free to refresh it. */
export const AUTO_VERDICT_AUTHOR = 'Runelabs (auto)';

/**
 * Per-tier falsifiers from model/proposal output: the per-field object the
 * generator is asked for, or a single string meaning "applies to every tier".
 * With `picks`, only tiers the proposal actually sets keep one. Anything
 * unusable → none, and the claim stays unregistered.
 */
export function pickFalsifiers(
  raw: unknown,
  picks?: Partial<Record<BoardField, string | null>>,
): ProposedFalsifiers {
  const out: ProposedFalsifiers = {};
  for (const f of PICK_FIELDS) {
    if (picks && !picks[f]) continue;
    const v =
      typeof raw === 'string'
        ? normalizeFalsifier(raw)
        : typeof raw === 'object' && raw !== null && !Array.isArray(raw)
          ? normalizeFalsifier((raw as Record<string, unknown>)[f])
          : undefined;
    if (v) out[f] = v;
  }
  return out;
}

/** The falsifiers stored in a proposal's JSON (its `falsifiers` key). */
export function parseFalsifiers(json: string): ProposedFalsifiers {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return pickFalsifiers((parsed as Record<string, unknown>).falsifiers);
  } catch {
    return {};
  }
}

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
  falsifiers: ProposedFalsifiers,
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

    // A reorder or cosmetic rewrite of the same combo is not a pick change —
    // logging it as one is how "A + B" → "B + A" showed up as a 0-day flip.
    const pickChanged = !samePick(existing?.pickName ?? null, pickName);
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

    // A pick change ends the previous claim and opens a new one, carrying the
    // falsifier the proposal stated in the same call that made the pick —
    // stated before the outcome, so it is pre-registered. No falsifier in the
    // proposal → UNREGISTERED; coverage is reported rather than faked (see
    // src/lib/kits/claims.ts).
    const claimCell = { category: cell.category, task: cell.task, tier };
    closeOpenClaim(claimCell, now);
    openClaim(buildClaim({ ...claimCell, pickName, openedAt: now, falsifier: falsifiers[field] }));
  }
}

export interface HeldField {
  field: BoardField;
  rule: 'min-hold' | 'revert';
  why: string;
}

/**
 * Runs each proposed pick through the damping rules (src/lib/board/damping.ts)
 * against the kit cell's current pick and history. Held picks are nulled out
 * of the returned copy so neither the board nor kit_picks takes them. If
 * anything was held the cost note is dropped too: it was written about a pick
 * set that is not being applied. Board tasks with no kit cell have no history
 * to damp against and pass through.
 */
function dampProposal(
  domain: string,
  task: string,
  proposed: ProposedFields,
  now: Date,
  policy: DampingPolicy,
): { damped: ProposedFields; held: HeldField[] } {
  const cell = boardCellToKitCell(domain, task);
  const damped = { ...proposed };
  const held: HeldField[] = [];
  if (!cell) return { damped, held };

  const db = getDb();
  for (const field of PICK_FIELDS) {
    const pickName = proposed[field];
    if (pickName === null) continue;
    const tier = TIER_BY_FIELD[field];
    const where = and(eq(kitPicks.category, cell.category), eq(kitPicks.task, cell.task), eq(kitPicks.tier, tier));
    const current = db.select({ pickName: kitPicks.pickName }).from(kitPicks).where(where).get();
    const history = db
      .select({ fromPick: kitPickHistory.fromPick, toPick: kitPickHistory.toPick, changedAt: kitPickHistory.changedAt })
      .from(kitPickHistory)
      .where(
        and(
          eq(kitPickHistory.category, cell.category),
          eq(kitPickHistory.task, cell.task),
          eq(kitPickHistory.tier, tier),
        ),
      )
      .all();
    const decision = decidePickChange({
      current: current?.pickName ?? null,
      proposed: pickName,
      history,
      now,
      policy,
      hasNewEvidence: storyEvidenceSince,
    });
    if (decision.kind === 'hold') {
      damped[field] = null;
      held.push({ field, rule: decision.rule, why: decision.why });
    }
  }
  if (held.length > 0) damped.costNote = null;
  return { damped, held };
}

export interface ApplyOptions {
  /**
   * Damp pick changes (min hold, no quick reverts without new evidence).
   * The auto-apply path in sync.ts passes the policy; the admin approve route
   * does not, because a human approving the rationale is the evidence.
   */
  damping?: DampingPolicy;
}

/**
 * Applies a pending proposal: upserts board_entries by (domain, task) with the
 * four proposed fields, appends a human-readable board_history row, and marks
 * the proposal approved. Missing/non-pending proposals → {ok:false}. With
 * opts.damping, picks the damping rules hold are skipped and reported in
 * `held` (and in the board_history row); the rest of the proposal applies.
 * A proposed pick that only reorders or re-spells the current one is never a
 * change, damped or not.
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
export async function applyProposal(
  proposalId: number,
  opts: ApplyOptions = {},
): Promise<{ ok: boolean; held: HeldField[] }> {
  const db = getDb();
  return db.transaction((tx) => {
    const claimed = tx
      .update(boardProposals)
      .set({ status: 'approved' })
      .where(and(eq(boardProposals.id, proposalId), eq(boardProposals.status, 'pending')))
      .run();
    if (claimed.changes === 0) return { ok: false, held: [] };
    // changes === 1 implies the row exists — we just wrote it.
    const proposal = tx.select().from(boardProposals).where(eq(boardProposals.id, proposalId)).get()!;

    const now = new Date();
    const parsed = parseProposed(proposal.proposed);
    const falsifiers = parseFalsifiers(proposal.proposed);
    const { damped: proposed, held } = opts.damping
      ? dampProposal(proposal.domain, proposal.task, parsed, now, opts.damping)
      : { damped: parsed, held: [] as HeldField[] };
    const existing = tx
      .select()
      .from(boardEntries)
      .where(and(eq(boardEntries.domain, proposal.domain), eq(boardEntries.task, proposal.task)))
      .get();

    // Only non-null proposed fields are applied — a partial proposal must never
    // wipe curated values it didn't mention. A pick that names the same
    // tool/combo as the board already shows keeps the board's spelling.
    const changes: Partial<ProposedFields> = {};
    for (const f of FIELDS) {
      if (proposed[f] === null) continue;
      if (f !== 'costNote' && samePick(existing?.[f] ?? null, proposed[f])) continue;
      changes[f] = proposed[f];
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
    // A held pick means the rationale argues for a pick set the board is not
    // taking — writing it as the verdict would describe the wrong tool.
    const verdictPatch = verdictClaimed || held.length > 0
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
      const diffs = FIELDS.filter((f) => changes[f] !== undefined && existing[f] !== changes[f]).map(
        (f) => `${f}: ${existing[f] ?? '(none)'} -> ${changes[f]}`,
      );
      change = diffs.length > 0 ? diffs.join('; ') : 'no field changes';
    }
    if (held.length > 0) {
      const notes = held.map((h) => `${h.field}: held (${h.why})`).join('; ');
      change = change === 'no field changes' ? notes : `${change}; ${notes}`;
    }
    tx.insert(boardHistory)
      .values({ domain: proposal.domain, task: proposal.task, change, appliedAt: now })
      .run();

    // mirrorToKitPicks and the claim repo write via getDb() — the same
    // connection this transaction is on, so those writes join it.
    mirrorToKitPicks(proposal.domain, proposal.task, proposed, now, proposal.rationale, falsifiers);

    return { ok: true, held };
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
