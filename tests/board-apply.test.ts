import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { boardEntries, boardHistory, boardProposals, kitPicks, kitPickHistory } from '@/lib/db/schema';
import { applyProposal, rejectProposal, AUTO_VERDICT_AUTHOR } from '@/lib/board/apply';
import { boardCellToKitCell } from '@/lib/kits/from-board';

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
    expect(entry.runelabsVerdict).toBe('solid'); // human-claimed verdict — never auto-overwritten
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

  it('a partial proposal preserves existing fields it does not mention', async () => {
    const pid = db
      .insert(boardProposals)
      .values({
        domain: 'coding',
        task: 'agentic-coding',
        proposed: JSON.stringify({ costNote: 'only the cost note changed' }),
        rationale: 'pricing update',
        status: 'pending',
        createdAt: new Date(),
      })
      .returning()
      .get().id;

    expect(await applyProposal(pid)).toEqual({ ok: true });

    const entry = db.select().from(boardEntries).where(eq(boardEntries.id, entryId)).get()!;
    expect(entry.costNote).toBe('only the cost note changed');
    // fields absent from the proposal keep their curated values
    expect(entry.bestOverall).toBe('GPT-5.2');
    expect(entry.bestValue).toBe('GLM-4.7');
    expect(entry.cheapestViable).toBe('DeepSeek-V4');

    const history = db.select().from(boardHistory).all();
    expect(history).toHaveLength(1);
    expect(history[0].change).toContain('costNote');
    expect(history[0].change).not.toContain('bestOverall');
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

describe('applyProposal mirrors into kit_picks', () => {
  let db: Db;

  beforeEach(() => {
    db = useTestDb();
  });

  async function approve(proposed: Record<string, string | null>, domain = 'video', task = 'avatar/talking-head') {
    const id = db
      .insert(boardProposals)
      .values({
        domain,
        task,
        proposed: JSON.stringify(proposed),
        rationale: 'test',
        status: 'pending',
        createdAt: new Date(),
      })
      .returning()
      .get().id;
    await applyProposal(id);
  }

  it('creates one kit_pick per proposed tier, with the renamed task', async () => {
    await approve({ bestOverall: 'Alpha', bestValue: 'Beta', cheapestViable: null });
    const rows = db.select().from(kitPicks).all();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.category === 'video' && r.task === 'avatar')).toBe(true);
    expect(rows.map((r) => `${r.tier}:${r.pickName}`).sort()).toEqual(['best:Alpha', 'value:Beta']);
  });

  it('updates an existing pick and logs the change to kit_pick_history', async () => {
    await approve({ bestOverall: 'Alpha' });
    await approve({ bestOverall: 'Gamma' });

    const rows = db.select().from(kitPicks).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].pickName).toBe('Gamma');

    const hist = db.select().from(kitPickHistory).all();
    const swap = hist.find((h) => h.fromPick === 'Alpha');
    expect(swap).toBeTruthy();
    expect(swap!.toPick).toBe('Gamma');
    expect(swap!.tier).toBe('best');
  });

  it('does not log history when the pick is unchanged', async () => {
    await approve({ bestOverall: 'Alpha' });
    const before = db.select().from(kitPickHistory).all().length;
    await approve({ bestOverall: 'Alpha' });
    expect(db.select().from(kitPickHistory).all()).toHaveLength(before);
  });

  // A board task with no kit cell must not block the board write.
  it('skips cells outside the kit grid without throwing', async () => {
    await approve({ bestOverall: 'Alpha' }, 'coding', 'not-a-real-task');
    expect(db.select().from(kitPicks).all()).toHaveLength(0);
    expect(boardCellToKitCell('coding', 'not-a-real-task')).toBeNull();
  });

  // INVARIANT: prices come from the pricing feeders, never from the board.
  it('never sets a price from the board cost note', async () => {
    await approve({ bestOverall: 'Alpha', costNote: 'Alpha $20/mo' });
    const row = db.select().from(kitPicks).all()[0];
    expect(row.priceUsdMonth).toBeNull();
    expect(row.priceNote).toBe('Alpha $20/mo');
  });

  it('refreshes priceNote when the pick is unchanged and costNote differs, without a history row', async () => {
    await approve({ bestOverall: 'Alpha', costNote: 'Alpha $20/mo' });
    const before = db.select().from(kitPickHistory).all().length;

    await approve({ bestOverall: 'Alpha', costNote: 'Alpha $25/mo' });

    const row = db.select().from(kitPicks).all()[0];
    expect(row.pickName).toBe('Alpha');
    expect(row.priceNote).toBe('Alpha $25/mo');
    expect(db.select().from(kitPickHistory).all()).toHaveLength(before);
  });

  it('keeps the previous priceNote when the pick changes without a costNote', async () => {
    await approve({ bestOverall: 'Alpha', costNote: 'Alpha $20/mo' });
    await approve({ bestOverall: 'Gamma' });

    const row = db.select().from(kitPicks).all()[0];
    expect(row.pickName).toBe('Gamma');
    expect(row.priceNote).toBe('Alpha $20/mo');
  });
});

describe('applyProposal auto-fills the board verdict from the reviewed rationale', () => {
  let db: Db;

  beforeEach(() => {
    db = useTestDb();
  });

  async function proposeAndApply(
    rationale: string,
    proposed: Record<string, string | null> = { bestOverall: 'Alpha' },
    domain = 'video',
    task = 'text-to-video',
  ) {
    const id = db
      .insert(boardProposals)
      .values({ domain, task, proposed: JSON.stringify(proposed), rationale, status: 'pending', createdAt: new Date() })
      .returning()
      .get().id;
    await applyProposal(id);
  }

  it('fills an empty verdict from the proposal rationale — the human already reviewed it to approve', async () => {
    await proposeAndApply('MiniMax H3 leads the video arena this week.');
    const entry = db.select().from(boardEntries).all()[0];
    expect(entry.runelabsVerdict).toBe('MiniMax H3 leads the video arena this week.');
    expect(entry.verdictAuthor).toBe(AUTO_VERDICT_AUTHOR);
  });

  it('refreshes an auto-written verdict on a later approval, keeping it in sync with the pick', async () => {
    await proposeAndApply('Alpha leads this week.', { bestOverall: 'Alpha' });
    await proposeAndApply('Beta overtook Alpha this week.', { bestOverall: 'Beta' });

    const entry = db.select().from(boardEntries).all()[0];
    expect(entry.bestOverall).toBe('Beta');
    expect(entry.runelabsVerdict).toBe('Beta overtook Alpha this week.');
    expect(entry.verdictAuthor).toBe(AUTO_VERDICT_AUTHOR);
  });

  // The invariant that matters: a human's editorial call is permanent.
  it('never overwrites a verdict a human wrote, no matter how many later proposals are approved', async () => {
    await proposeAndApply('Alpha leads this week.', { bestOverall: 'Alpha' });
    db.update(boardEntries)
      .set({ runelabsVerdict: 'I disagree with the algorithm — sticking with Alpha.', verdictAuthor: 'specter' })
      .where(and(eq(boardEntries.domain, 'video'), eq(boardEntries.task, 'text-to-video')))
      .run();

    await proposeAndApply('Beta overtook Alpha this week.', { bestOverall: 'Beta' });

    const entry = db.select().from(boardEntries).all()[0];
    expect(entry.bestOverall).toBe('Beta'); // the pick still updates
    expect(entry.runelabsVerdict).toBe('I disagree with the algorithm — sticking with Alpha.');
    expect(entry.verdictAuthor).toBe('specter');
  });
});
