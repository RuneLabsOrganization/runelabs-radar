import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { verdictClaims } from '@/lib/db/schema';
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
