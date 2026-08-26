import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/lib/opportunities/critic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/opportunities/critic')>();
  return { ...actual, runDebate: vi.fn() };
});

import { forgeOpportunity } from '@/lib/opportunities/forge';
import { runDebate, type DebateResult } from '@/lib/opportunities/critic';
import { opportunities } from '@/lib/db/schema';
import { SUB_KEYS } from '@/lib/opportunities/engine';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

const debateMock = vi.mocked(runDebate);

const PINNED: DebateResult = {
  transcript: [
    { role: 'advocate', text: 'Demand is recurring in the pains stream.' },
    { role: 'skeptic', text: 'An incumbent ships this inside two releases.' },
    { role: 'realist', text: 'Comps say the niche clears $20k MRR but no more.' },
    { role: 'judge', text: 'Watch: real opening, named platform risk.' },
  ],
  verdict: 'watch',
  confidence: 55,
  killRisks: ['Platform absorbs the feature natively'],
  conditionsToSucceed: ['own one niche distribution channel'],
  strengthenedVariants: ['niche down to Plus sellers', 'usage-based API instead of a dashboard'],
};

function seedOpp(db: Db, slug: string, ownerUserId: number): number {
  const now = new Date();
  const sub = Object.fromEntries(SUB_KEYS.map((k) => [k, 14]));
  return db
    .insert(opportunities)
    .values({
      slug, ownerUserId, title: `Title for ${slug}`,
      thesis: 'A sufficiently long thesis for the forge to work against.',
      sector: 'devtools', status: 'active', flipScore: 70, holdScore: 50,
      scores: JSON.stringify(sub),
      // two citations so the gate does not cap debate confidence at 30
      evidence: JSON.stringify([
        { type: 'pain', label: 'P1' },
        { type: 'pattern', label: 'A1' },
      ]),
      firstSeenAt: now, lastSeenAt: now,
    })
    .returning({ id: opportunities.id })
    .get()!.id;
}

describe('forgeOpportunity', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    seedUser(db, 1);
    seedUser(db, 2);
    debateMock.mockReset();
    debateMock.mockResolvedValue(PINNED);
  });

  it('re-scores the opportunity from the debate outcome', async () => {
    const id = seedOpp(db, 'forge-me', 1);
    const res = await forgeOpportunity(id, 1);
    expect(res.ok).toBe(true);

    const row = db.select().from(opportunities).where(eq(opportunities.id, id)).get()!;
    expect(row.verdict).toBe('watch');
    expect(row.confidence).toBe(55);
    const review = JSON.parse(row.review!);
    expect(review.killRisks).toContain('Platform absorbs the feature natively');
    expect(review.flags).toContain('forged');
  });

  it('bills the debate calls to the forge feature', async () => {
    const id = seedOpp(db, 'billed', 1);
    await forgeOpportunity(id, 1);
    // 3rd arg stays userId (scope); feature is 4th so spend is not charged to debate
    expect(debateMock).toHaveBeenCalledWith(id, undefined, 1, 'forge');
  });

  it('refuses an opportunity the caller does not own', async () => {
    const id = seedOpp(db, 'theirs', 2);
    const res = await forgeOpportunity(id, 1);
    expect(res.ok).toBe(false);
    expect(debateMock).not.toHaveBeenCalled();
  });

  it('allows forging a public radar opening', async () => {
    const now = new Date();
    const sub = Object.fromEntries(SUB_KEYS.map((k) => [k, 14]));
    const id = db
      .insert(opportunities)
      .values({
        slug: 'public-one', ownerUserId: null, title: 'Public opening',
        thesis: 'A canonical radar opening anybody may pressure-test.',
        sector: 'devtools', status: 'active', flipScore: 70, holdScore: 50,
        scores: JSON.stringify(sub), evidence: '[]', firstSeenAt: now, lastSeenAt: now,
      })
      .returning({ id: opportunities.id })
      .get()!.id;
    expect((await forgeOpportunity(id, 1)).ok).toBe(true);
  });

  it('reports failure instead of throwing when the debate errors', async () => {
    debateMock.mockRejectedValue(new Error('upstream 503'));
    const id = seedOpp(db, 'flaky', 1);
    const res = await forgeOpportunity(id, 1);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/503/);
  });
});
