import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { boardProposals, verdictClaims } from '@/lib/db/schema';
import { applyProposal } from '@/lib/board/apply';
import { DEFAULT_HORIZON_DAYS, UNREGISTERED, buildClaim } from '@/lib/kits/claims';
import { closeOpenClaim, openClaim, openClaimFor } from '@/lib/kits/claims-repo';
import { useTestDb } from './helpers/db';

const CELL = { category: 'coding', task: 'agent', tier: 'best' as const };

describe('buildClaim', () => {
  it('records the falsifier verbatim with the default horizon', () => {
    const c = buildClaim({ ...CELL, pickName: 'Tool A', falsifier: 'Tool B beats it on SWE-bench' });
    expect(c.falsifier).toBe('Tool B beats it on SWE-bench');
    expect(c.horizonDays).toBe(DEFAULT_HORIZON_DAYS);
  });

  it('marks a missing falsifier as unregistered rather than inventing one', () => {
    expect(buildClaim({ ...CELL, pickName: 'Tool A' }).falsifier).toBe(UNREGISTERED);
  });

  it('serialises the evidence snapshot as JSON', () => {
    const c = buildClaim({ ...CELL, pickName: 'Tool A', evidence: ['https://a.test/1'] });
    expect(JSON.parse(c.evidenceSnapshot)).toEqual(['https://a.test/1']);
  });
});

describe('claims repo', () => {
  beforeEach(() => useTestDb());

  it('opens a claim and finds it as the open claim for the cell', () => {
    openClaim(buildClaim({ ...CELL, pickName: 'Tool A', falsifier: 'B ships' }));
    expect(openClaimFor(CELL)!.pickName).toBe('Tool A');
  });

  it('closes the open claim and leaves it unfindable as open', () => {
    openClaim(buildClaim({ ...CELL, pickName: 'Tool A', falsifier: 'B ships' }));
    const closedAt = new Date();
    closeOpenClaim(CELL, closedAt);

    expect(openClaimFor(CELL)).toBeNull();
    const row = getDb().select().from(verdictClaims).get()!;
    expect(row.closedAt?.getTime()).toBe(closedAt.getTime());
    expect(row.outcome).toBeNull(); // the grader fills this in, not the closer
  });

  it('returns the newest open claim when several exist for a cell', () => {
    openClaim(buildClaim({ ...CELL, pickName: 'Tool A', falsifier: 'x', openedAt: new Date(1000) }));
    openClaim(buildClaim({ ...CELL, pickName: 'Tool B', falsifier: 'y', openedAt: new Date(2000) }));
    expect(openClaimFor(CELL)!.pickName).toBe('Tool B');
  });
});

describe('claims are opened by the board apply path', () => {
  beforeEach(() => useTestDb());

  it('opens a claim when a pick changes and closes the prior one', async () => {
    const db = getDb();
    const proposalId = db
      .insert(boardProposals)
      .values({
        domain: 'coding',
        task: 'agentic-coding',
        proposed: JSON.stringify({ bestOverall: 'Tool A', costNote: null }),
        rationale: 'initial call',
        status: 'pending',
        createdAt: new Date(),
      })
      .returning({ id: boardProposals.id })
      .get().id;

    await applyProposal(proposalId);
    const first = openClaimFor({ category: 'coding', task: 'agentic-coding', tier: 'best' });
    expect(first?.pickName).toBe('Tool A');
    expect(first?.falsifier).toBe(UNREGISTERED);

    const secondId = db
      .insert(boardProposals)
      .values({
        domain: 'coding',
        task: 'agentic-coding',
        proposed: JSON.stringify({ bestOverall: 'Tool B', costNote: null }),
        rationale: 'Tool B overtook it',
        status: 'pending',
        createdAt: new Date(),
      })
      .returning({ id: boardProposals.id })
      .get().id;

    await applyProposal(secondId);

    const all = db.select().from(verdictClaims).all();
    expect(all).toHaveLength(2);
    const closed = all.find((c) => c.pickName === 'Tool A')!;
    expect(closed.closedAt).not.toBeNull();
    expect(openClaimFor({ category: 'coding', task: 'agentic-coding', tier: 'best' })!.pickName).toBe('Tool B');
  });
});
