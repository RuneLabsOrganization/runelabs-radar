import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

const criticActual = vi.hoisted(() => ({
  runDebate: undefined as typeof import('@/lib/opportunities/critic').runDebate | undefined,
}));

vi.mock('@/lib/opportunities/critic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/opportunities/critic')>();
  criticActual.runDebate = actual.runDebate;
  return { ...actual, runDebate: vi.fn() };
});

import { forgeOpportunity } from '@/lib/opportunities/forge';
import { runDebate, type DebateResult } from '@/lib/opportunities/critic';
import { _setFetch } from '@/lib/llm/minimax';
import { llmCalls, opportunities, painPoints, stories } from '@/lib/db/schema';
import { runOpportunities, SUB_KEYS } from '@/lib/opportunities/engine';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

const debateMock = vi.mocked(runDebate);

const PINNED: DebateResult = {
  id: 1,
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

// --- daily-sweep helpers (engine hysteresis test) ---

function seedSignal(db: Db): void {
  for (let i = 0; i < 3; i++) {
    db.insert(painPoints)
      .values({ summary: `paid need number ${i} that keeps recurring`, intensity: 2, evidence: '[]', lastSeenAt: new Date(), createdAt: new Date() })
      .run();
    db.insert(stories)
      .values({ title: `signal story ${i}`, tldr: 'tldr', status: 'curated', topScore: 80, createdAt: new Date() })
      .run();
  }
}

/** Proposer re-detects `slug` with low sub-scores; the critic pursues it. */
function mockEngineSweep(slug: string, score: number): void {
  const draft = {
    slug,
    title: `Opening ${slug} with a long enough title`,
    thesis: `Thesis for ${slug}: demand is recurring, the tooling gap is real, and nobody ships the fix yet.`,
    sector: 'devtools',
    window: '6-9 months',
    subScores: Object.fromEntries(SUB_KEYS.map((k) => [k, score])),
    kpis: { initialCostUsd: 250, timeToMvpDays: 9 },
    evidenceRefs: ['P1'],
  };
  _setFetch((async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { content: string }[] };
    const system = body.messages[0]!.content;
    let payload: unknown;
    if (system.includes('opportunity scout')) {
      payload = { opportunities: [draft] };
    } else if (system.includes('red-team reviewer')) {
      payload = {
        reviews: [{ slug, verdict: 'pursue', confidence: 80, killRisks: [], axisAdjustments: [], coherenceFlags: [] }],
      };
    } else {
      throw new Error('unexpected LLM call in test');
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }),
    } as Response;
  }) as unknown as typeof fetch);
}

describe('forgeOpportunity', () => {
  let db: Db;
  const savedKey = process.env.MINIMAX_API_KEY;
  beforeEach(() => {
    db = useTestDb();
    seedUser(db, 1);
    seedUser(db, 2);
    debateMock.mockReset();
    debateMock.mockResolvedValue(PINNED);
    process.env.MINIMAX_API_KEY = 'test-key';
  });
  afterEach(() => {
    _setFetch(globalThis.fetch);
    if (savedKey === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = savedKey;
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

  it('forging a public opening writes an owner-scoped copy — the canonical row is untouched', async () => {
    const now = new Date();
    const sub = Object.fromEntries(SUB_KEYS.map((k) => [k, 14]));
    const id = db
      .insert(opportunities)
      .values({
        slug: 'public-one', ownerUserId: null, title: 'Public opening',
        thesis: 'A canonical radar opening anybody may pressure-test.',
        sector: 'devtools', status: 'active', flipScore: 70, holdScore: 50,
        scores: JSON.stringify(sub),
        // two citations so the gate does not cap debate confidence at 30
        evidence: JSON.stringify([{ type: 'pain', label: 'P1' }, { type: 'pattern', label: 'A1' }]),
        firstSeenAt: now, lastSeenAt: now,
      })
      .returning({ id: opportunities.id })
      .get()!.id;

    const res = await forgeOpportunity(id, 1);
    expect(res.ok).toBe(true);

    // canonical public row: scores, verdict and review trail unchanged
    const pub = db.select().from(opportunities).where(eq(opportunities.id, id)).get()!;
    expect(pub.flipScore).toBe(70);
    expect(pub.holdScore).toBe(50);
    expect(pub.review).toBeNull();
    expect(pub.reviewedAt).toBeNull();

    // the forge landed on a new owner-scoped copy of the same slug
    const copy = db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.slug, 'public-one'), eq(opportunities.ownerUserId, 1)))
      .get()!;
    expect(copy.id).not.toBe(id);
    expect(copy.status).toBe('active');
    expect(copy.verdict).toBe('watch');
    expect(copy.confidence).toBe(55);
    const review = JSON.parse(copy.review!);
    expect(review.flags).toContain('forged');
    expect(review.killRisks).toContain('Platform absorbs the feature natively');

    // the debate ran against the copy, never the canonical row
    expect(debateMock).toHaveBeenCalledWith(copy.id, undefined, 1, 'forge');
    // the result reflects the copy's re-scored values
    expect(res.flipScore).toBe(copy.flipScore);
    expect(res.holdScore).toBe(copy.holdScore);
  });

  it('re-forging the same public opening reuses the existing owner copy', async () => {
    const now = new Date();
    const sub = Object.fromEntries(SUB_KEYS.map((k) => [k, 14]));
    const id = db
      .insert(opportunities)
      .values({
        slug: 'public-twice', ownerUserId: null, title: 'Public opening',
        thesis: 'A canonical radar opening anybody may pressure-test.',
        sector: 'devtools', status: 'active', flipScore: 70, holdScore: 50,
        scores: JSON.stringify(sub), evidence: '[]', firstSeenAt: now, lastSeenAt: now,
      })
      .returning({ id: opportunities.id })
      .get()!.id;

    expect((await forgeOpportunity(id, 1)).ok).toBe(true);
    expect((await forgeOpportunity(id, 1)).ok).toBe(true);

    // canonical + exactly one owner copy (owner+slug is the unique key)
    expect(db.select().from(opportunities).where(eq(opportunities.slug, 'public-twice')).all()).toHaveLength(2);
    // still nothing written to the canonical row
    expect(db.select().from(opportunities).where(eq(opportunities.id, id)).get()!.review).toBeNull();
  });

  it('the daily engine hysteresis never blends the forged copy into public scores', async () => {
    const now = new Date();
    const sub = Object.fromEntries(SUB_KEYS.map((k) => [k, 14]));
    const publicId = db
      .insert(opportunities)
      .values({
        slug: 'public-one', ownerUserId: null, title: 'Public opening',
        thesis: 'A canonical radar opening anybody may pressure-test.',
        sector: 'devtools', status: 'active', flipScore: 70, holdScore: 50,
        scores: JSON.stringify(sub),
        evidence: JSON.stringify([{ type: 'pain', label: 'P1' }, { type: 'pattern', label: 'A1' }]),
        firstSeenAt: now, lastSeenAt: now,
      })
      .returning({ id: opportunities.id })
      .get()!.id;

    expect((await forgeOpportunity(publicId, 1)).ok).toBe(true);
    const forged = db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.slug, 'public-one'), eq(opportunities.ownerUserId, 1)))
      .get()!;

    // daily sweep: the proposer re-detects the same slug with much lower sub-scores
    seedSignal(db);
    mockEngineSweep('public-one', 4);
    const out = await runOpportunities();
    expect(out.refreshed).toBe(1);

    // the PUBLIC row hysteresis-blended toward the new gate score…
    const pub = db.select().from(opportunities).where(eq(opportunities.id, publicId)).get()!;
    expect(pub.flipScore).not.toBe(70);
    // …while the forged copy was never part of the blend: same forged scores,
    // same forged review trail
    const after = db.select().from(opportunities).where(eq(opportunities.id, forged.id)).get()!;
    expect(after.flipScore).toBe(forged.flipScore);
    expect(after.holdScore).toBe(forged.holdScore);
    expect(JSON.parse(after.review!).flags).toContain('forged');
  });

  it('reports failure instead of throwing when the debate errors', async () => {
    debateMock.mockRejectedValue(new Error('upstream 503'));
    const id = seedOpp(db, 'flaky', 1);
    const res = await forgeOpportunity(id, 1);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/503/);
  });

  it('writes llm_calls rows tagged forge for the calling user', async () => {
    debateMock.mockImplementation(criticActual.runDebate!);
    const payloads = [
      { text: 'The demand is proven: three recurring pains name this gap and prices fell this quarter so a focused API undercuts incumbents.' },
      { text: 'An incumbent ships this inside two releases and the advocate overstates how long the window stays open for a newcomer.' },
      { text: 'The comps show per-image tools exiting at 3-5x ARR, launch activity is up, and current model prices do support the stated margin.' },
      {
        verdict: 'watch',
        confidence: 55,
        reasoning: 'Demand evidence is real but platform risk is named and not yet mitigated by positioning.',
        killRisks: ['Platform absorbs the feature natively'],
        conditionsToSucceed: ['own one niche distribution channel'],
        strengthenedVariants: ['niche down to Plus sellers', 'usage-based API instead of a dashboard'],
      },
    ];
    _setFetch((async () => {
      const payload = payloads.shift();
      if (payload === undefined) throw new Error('unexpected extra LLM call in test');
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(payload) } }],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
      } as Response;
    }) as unknown as typeof fetch);

    const id = seedOpp(db, 'metered-forge', 1);
    const res = await forgeOpportunity(id, 1);
    expect(res.ok).toBe(true);

    const rows = db.select().from(llmCalls).all();
    expect(rows.some((r) => r.feature === 'forge' && r.userId === 1)).toBe(true);
  });

  it('flags corrupt stored scores as legacy instead of gating all-zeros as "terrible" (F7)', async () => {
    const now = new Date();
    const id = db
      .insert(opportunities)
      .values({
        slug: 'corrupt-scores', ownerUserId: 1, title: 'Corrupt stored scores',
        thesis: 'A sufficiently long thesis for the forge to work against.',
        sector: 'devtools', status: 'active', flipScore: 70, holdScore: 50,
        scores: '{not-json',
        evidence: JSON.stringify([{ type: 'pain', label: 'P1' }, { type: 'pattern', label: 'A1' }]),
        firstSeenAt: now, lastSeenAt: now,
      })
      .returning({ id: opportunities.id })
      .get()!.id;

    const res = await forgeOpportunity(id, 1);
    expect(res.ok).toBe(true);
    const row = db.select().from(opportunities).where(eq(opportunities.id, id)).get()!;
    const review = JSON.parse(row.review!);
    // pre-fix: forge's private parser zero-filled corrupt JSON with NO legacy
    // flag, so the gate treated the row as genuinely zero on every axis
    expect(review.flags).toContain('legacy-row');
    expect(row.verdict).toBe('watch');
    expect(row.confidence).toBe(40); // R10: legacy rows are never gated strong
  });

  it('does not NaN when stored kpis or evidence JSON is malformed', async () => {
    const now = new Date();
    const sub = Object.fromEntries(SUB_KEYS.map((k) => [k, 14]));
    const id = db
      .insert(opportunities)
      .values({
        slug: 'bad-json', ownerUserId: 1, title: 'Malformed stored kpis',
        thesis: 'A sufficiently long thesis for the forge to work against.',
        sector: 'devtools', status: 'active', flipScore: 70, holdScore: 50,
        scores: JSON.stringify(sub),
        kpis: JSON.stringify({
          priceUsd: 'free', monthlyCostUsd: 50, breakEvenCustomers: 10, initialCostUsd: 100,
        }),
        evidence: '{not-json',
        windowMonths: 6,
        firstSeenAt: now, lastSeenAt: now,
      })
      .returning({ id: opportunities.id })
      .get()!.id;

    const res = await forgeOpportunity(id, 1);
    expect(res.ok).toBe(true);
    expect(Number.isFinite(res.flipScore)).toBe(true);
    expect(Number.isFinite(res.holdScore)).toBe(true);
    expect(Number.isFinite(res.confidence)).toBe(true);
  });
});
