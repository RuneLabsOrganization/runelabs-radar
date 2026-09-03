import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { boardHistory, boardProposals, kitPickHistory, verdictClaims } from '@/lib/db/schema';
import { applyProposal } from '@/lib/board/apply';

// The apply path is transaction-guarded: a conditional status flip claims the
// proposal, so a double-click / concurrent approval can only ever apply once.
describe('applyProposal concurrency guard', () => {
  let db: Db;
  let proposalId: number;

  beforeEach(() => {
    db = useTestDb();
    proposalId = db
      .insert(boardProposals)
      .values({
        domain: 'video',
        task: 'avatar/talking-head',
        proposed: JSON.stringify({ bestOverall: 'Alpha', bestValue: null, cheapestViable: null, costNote: null }),
        rationale: 'first pass',
        status: 'pending',
        createdAt: new Date(),
      })
      .returning()
      .get().id;
  });

  it('two concurrent applies produce exactly one history set', async () => {
    const results = await Promise.all([applyProposal(proposalId), applyProposal(proposalId)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);

    expect(db.select().from(boardHistory).all()).toHaveLength(1);
    expect(db.select().from(kitPickHistory).all()).toHaveLength(1);
    // exactly one claim opened — a double-apply would open a second one
    expect(db.select().from(verdictClaims).all()).toHaveLength(1);
  });

  it('a later apply of an already-approved proposal is a no-op', async () => {
    expect(await applyProposal(proposalId)).toEqual({ ok: true });
    expect(await applyProposal(proposalId)).toEqual({ ok: false });

    expect(db.select().from(boardHistory).all()).toHaveLength(1);
    expect(db.select().from(kitPickHistory).all()).toHaveLength(1);
    expect(db.select().from(verdictClaims).all()).toHaveLength(1);
  });
});
