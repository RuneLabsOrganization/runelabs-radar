import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { boardEntries, boardHistory, boardProposals } from '../db/schema';

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
  db.insert(boardEntries)
    .values({ domain: proposal.domain, task: proposal.task, ...proposed, updatedAt: now })
    .onConflictDoUpdate({
      target: [boardEntries.domain, boardEntries.task],
      set: { ...proposed, updatedAt: now },
    })
    .run();

  const wasEmpty = !existing || FIELDS.every((f) => existing[f] === null);
  let change: string;
  if (wasEmpty) {
    change = 'initial values set';
  } else {
    const diffs = FIELDS.filter((f) => existing[f] !== proposed[f]).map(
      (f) => `${f}: ${existing[f] ?? '(none)'} -> ${proposed[f] ?? '(none)'}`,
    );
    change = diffs.length > 0 ? diffs.join('; ') : 'no field changes';
  }
  db.insert(boardHistory)
    .values({ domain: proposal.domain, task: proposal.task, change, appliedAt: now })
    .run();

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
