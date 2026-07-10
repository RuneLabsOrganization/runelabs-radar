import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { boardEntries, boardHistory, boardProposals } from '@/lib/db/schema';
import { applyProposal, rejectProposal } from '@/lib/board/apply';

describe('board proposal apply/reject', () => {
  let db: Db;
  let entryId: number;
  let proposalId: number;
  const originalUpdatedAt = new Date('2026-07-01T00:00:00Z');

  beforeEach(() => {
    db = useTestDb();
    entryId = db
      .insert(boardEntries)
      .values({
        domain: 'coding',
        task: 'agentic-coding',
        bestOverall: 'GPT-5.2',
        bestValue: 'GLM-4.7',
        cheapestViable: 'DeepSeek-V4',
        costNote: 'old cost note',
        runelabsVerdict: 'solid',
        verdictAuthor: 'specter',
        updatedAt: originalUpdatedAt,
      })
      .returning()
      .get().id;
    proposalId = db
      .insert(boardProposals)
      .values({
        domain: 'coding',
        task: 'agentic-coding',
        proposed: JSON.stringify({
          bestOverall: 'Claude Fable 5',
          bestValue: 'GLM-4.7',
          cheapestViable: 'DeepSeek-V4',
          costNote: 'new cost note',
        }),
        rationale: 'benchmarks moved',
        status: 'pending',
        createdAt: new Date(),
      })
      .returning()
      .get().id;
  });

  it('applyProposal updates entry fields, writes a diff history row, approves the proposal', async () => {
    expect(await applyProposal(proposalId)).toEqual({ ok: true });

    const entry = db.select().from(boardEntries).where(eq(boardEntries.id, entryId)).get()!;
    expect(entry.bestOverall).toBe('Claude Fable 5');
    expect(entry.bestValue).toBe('GLM-4.7');
    expect(entry.cheapestViable).toBe('DeepSeek-V4');
    expect(entry.costNote).toBe('new cost note');
    expect(entry.runelabsVerdict).toBe('solid'); // verdict untouched by apply
    expect(entry.verdictAuthor).toBe('specter');
    expect(entry.updatedAt!.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());

    const history = db.select().from(boardHistory).all();
    expect(history).toHaveLength(1);
    expect(history[0].domain).toBe('coding');
    expect(history[0].task).toBe('agentic-coding');
    expect(history[0].change).toContain('GPT-5.2'); // old value
    expect(history[0].change).toContain('Claude Fable 5'); // new value
    expect(history[0].change).toContain('old cost note');
    expect(history[0].change).toContain('new cost note');
    // unchanged fields are not part of the summary
    expect(history[0].change).not.toContain('bestValue');

    const proposal = db.select().from(boardProposals).where(eq(boardProposals.id, proposalId)).get()!;
    expect(proposal.status).toBe('approved');
  });

  it('creates the entry and logs "initial values set" when no entry existed', async () => {
    const pid = db
      .insert(boardProposals)
      .values({
        domain: 'copy',
        task: 'social',
        proposed: JSON.stringify({
          bestOverall: 'Claude Fable 5',
          bestValue: null,
          cheapestViable: null,
          costNote: null,
        }),
        rationale: 'first pass',
        status: 'pending',
        createdAt: new Date(),
      })
      .returning()
      .get().id;

    expect(await applyProposal(pid)).toEqual({ ok: true });

    const entry = db.select().from(boardEntries).where(eq(boardEntries.domain, 'copy')).get()!;
    expect(entry.task).toBe('social');
    expect(entry.bestOverall).toBe('Claude Fable 5');
    expect(entry.bestValue).toBeNull();

    const history = db.select().from(boardHistory).all();
    expect(history).toHaveLength(1);
    expect(history[0].change).toBe('initial values set');
  });

  it('rejectProposal only flips status and leaves the entry untouched', async () => {
    expect(await rejectProposal(proposalId)).toEqual({ ok: true });

    const proposal = db.select().from(boardProposals).where(eq(boardProposals.id, proposalId)).get()!;
    expect(proposal.status).toBe('rejected');

    const entry = db.select().from(boardEntries).where(eq(boardEntries.id, entryId)).get()!;
    expect(entry.bestOverall).toBe('GPT-5.2');
    expect(entry.costNote).toBe('old cost note');
    expect(entry.updatedAt!.getTime()).toBe(originalUpdatedAt.getTime());

    expect(db.select().from(boardHistory).all()).toHaveLength(0);
  });

  it('returns {ok:false} for missing or non-pending proposals', async () => {
    expect(await applyProposal(999999)).toEqual({ ok: false });
    expect(await rejectProposal(999999)).toEqual({ ok: false });

    await rejectProposal(proposalId);
    expect(await applyProposal(proposalId)).toEqual({ ok: false });
    expect(await rejectProposal(proposalId)).toEqual({ ok: false });

    // entry still untouched after the failed apply
    const entry = db.select().from(boardEntries).where(eq(boardEntries.id, entryId)).get()!;
    expect(entry.bestOverall).toBe('GPT-5.2');
    expect(db.select().from(boardHistory).all()).toHaveLength(0);
  });
});
