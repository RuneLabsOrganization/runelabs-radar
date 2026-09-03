import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { admitPlanGeneration, usageThisCycle } from '@/lib/billing';
import { llmCalls, opportunities } from '@/lib/db/schema';
import { _setFetch } from '@/lib/llm/minimax';
import { generatePlan } from '@/lib/plans/generate';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

// B8: a second caller attaching to an in-flight generation (same opp +
// visibility key) must be metered consistently with the admission design —
// every fresh plan served costs one quota slot, cache hits and failed
// generations are free, and a same-caller retry never double-meters.

const BRIEF_JSON = {
  icp: 'E-commerce operators with large catalogs who pay per-image editors',
  mvp: ['upload API', 'background removal worker', 'credit billing'],
  stackVenture: 'ai-product',
  stackNotes: null,
  unitEconomics: { assumptions: ['test'], monthlyCostUsd: 40, suggestedPriceUsd: 29, breakEvenCustomers: 2 },
  gtm: ['shopify app store'],
  risks: ['platform dependency'],
};

const FRAME_JSON = {
  title: 'Bulk background-removal API',
  overview: 'A focused API selling bulk background removal to e-commerce sellers, riding newly-cheap image models.',
  icp: 'E-commerce operators with 500+ SKUs paying per-image editors today',
  pricing: { model: 'usage credits', priceUsd: 29, notes: '10x undercut of manual editing' },
  stackVenture: 'ai-product',
};

function phaseJson(phase: string) {
  const mk = (n: number) => ({
    id: `${phase}-${n}`,
    title: `${phase} task ${n}`,
    detail: `Concrete instructions for ${phase} task ${n}, long enough to validate.`,
    dependsOn: [],
    filesToTouch: ['src/index.ts'],
    tools: ['next'],
    acceptance: [`${phase} task ${n} observable criterion`],
    verify: 'npm test',
    estimateHours: 2,
    rollback: 'git revert',
  });
  return { goal: `${phase} goal sentence, long enough.`, tasks: [mk(1), mk(2)] };
}

/** failBuild: both "build" phase attempts return an unvalidatable draft (<2 tasks). */
function mockMinimax(opts?: { failBuild?: boolean }): { calls: string[] } {
  const calls: string[] = [];
  _setFetch((async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { content: string }[] };
    const system = body.messages[0]!.content;
    const user = body.messages[1]!.content;
    let payload: unknown;
    if (system.includes('launch brief')) {
      payload = BRIEF_JSON;
      calls.push('brief');
    } else if (user.includes('plan frame')) {
      payload = FRAME_JSON;
      calls.push('frame');
    } else {
      const m = /Write the "(\w+)" phase/.exec(user);
      if (!m) throw new Error('unexpected LLM call in test');
      payload = opts?.failBuild && m[1] === 'build' ? { goal: 'too thin', tasks: [{ id: 'build-1' }] } : phaseJson(m[1]!);
      calls.push(`phase:${m[1]}`);
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: {} }),
    } as Response;
  }) as unknown as typeof fetch);
  return { calls };
}

function seedOpportunity(db: Db, slug = 'bulk-bg-removal-api'): number {
  return db
    .insert(opportunities)
    .values({
      slug,
      title: 'Bulk background-removal API',
      thesis: 'Sellers need cheap bulk background removal; new image models make it 10x cheaper to offer.',
      sector: 'ai-media',
      status: 'active',
      flipScore: 72,
      holdScore: 55,
      scores: JSON.stringify({ demand: 16, buildability: 15 }),
      kpis: null,
      evidence: '[]',
      verdict: 'pursue',
      confidence: 60,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    .returning({ id: opportunities.id })
    .get()!.id;
}

function planFeatures(db: Db, userId: number): string[] {
  return db
    .select({ feature: llmCalls.feature })
    .from(llmCalls)
    .where(eq(llmCalls.userId, userId))
    .all()
    .map((r) => r.feature);
}

describe('in-flight generation sharing across callers', () => {
  let db: Db;
  let userA: number;
  let userB: number;
  let oppId: number;

  beforeEach(() => {
    db = useTestDb();
    userA = seedUser(db);
    userB = seedUser(db);
    oppId = seedOpportunity(db);
    process.env.MINIMAX_API_KEY = 'test-key';
  });

  it('meters BOTH users when a second user attaches to the same in-flight generation', async () => {
    const { calls } = mockMinimax();
    const admA = admitPlanGeneration(userA);
    const admB = admitPlanGeneration(userB);
    expect(admA.ok && admB.ok).toBe(true);

    // B's call lands while A's generation is in flight — same opp, same visibility
    const pA = generatePlan(oppId, { userId: userA, admissionId: admA.admissionId });
    const pB = generatePlan(oppId, { userId: userB, admissionId: admB.admissionId });
    const [resA, resB] = await Promise.all([pA, pB]);

    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);
    if (resA.ok && resB.ok) {
      expect(resA.cached).toBe(false);
      expect(resB.cached).toBe(false);
      expect(resB.plan.title).toBe(resA.plan.title);
    }
    // one shared generation (brief + frame + 5 phases), not two
    expect(calls).toHaveLength(7);
    // each caller paid exactly one quota slot for the fresh plan they received
    expect(usageThisCycle(userA)).toBe(1);
    expect(usageThisCycle(userB)).toBe(1);
    expect(planFeatures(db, userA).filter((f) => f === 'plan')).toHaveLength(1);
    expect(planFeatures(db, userB).filter((f) => f === 'plan')).toHaveLength(1);
  });

  it('shares the generation and meters ONCE when the same caller retries concurrently', async () => {
    const { calls } = mockMinimax();
    const adm1 = admitPlanGeneration(userA);
    const adm2 = admitPlanGeneration(userA);
    expect(usageThisCycle(userA)).toBe(2); // two slots held at entry

    const p1 = generatePlan(oppId, { userId: userA, admissionId: adm1.admissionId });
    const p2 = generatePlan(oppId, { userId: userA, admissionId: adm2.admissionId });
    const [res1, res2] = await Promise.all([p1, p2]);

    expect(res1.ok && res2.ok).toBe(true);
    expect(calls).toHaveLength(7); // one generation served both calls
    // the retry's duplicate reservation was handed back — one plan, one slot
    expect(usageThisCycle(userA)).toBe(1);
    expect(planFeatures(db, userA).filter((f) => f === 'plan')).toHaveLength(1);
  });

  it('releases the attaching caller\'s slot when the shared generation FAILS', async () => {
    mockMinimax({ failBuild: true });
    const admA = admitPlanGeneration(userA);
    const admB = admitPlanGeneration(userB);

    const [resA, resB] = await Promise.all([
      generatePlan(oppId, { userId: userA, admissionId: admA.admissionId }),
      generatePlan(oppId, { userId: userB, admissionId: admB.admissionId }),
    ]);

    expect(resA.ok).toBe(false);
    expect(resB.ok).toBe(false);
    // a failed generation consumes nobody's quota — owner compensated, attacher released
    expect(usageThisCycle(userA)).toBe(0);
    expect(usageThisCycle(userB)).toBe(0);
    expect(planFeatures(db, userB)).not.toContain('plan');
  });

  it('releases the attaching caller\'s slot when the shared run resolves to a CACHE HIT', async () => {
    mockMinimax();
    const first = await generatePlan(oppId, { userId: userA });
    expect(first.ok).toBe(true);
    expect(usageThisCycle(userA)).toBe(1);

    // race window: A's repeat call creates the in-flight entry, B attaches
    // before it resolves — both observe the cached plan
    const admA2 = admitPlanGeneration(userA);
    const admB = admitPlanGeneration(userB);
    const [resA, resB] = await Promise.all([
      generatePlan(oppId, { userId: userA, admissionId: admA2.admissionId }),
      generatePlan(oppId, { userId: userB, admissionId: admB.admissionId }),
    ]);

    expect(resA).toMatchObject({ ok: true, cached: true });
    expect(resB).toMatchObject({ ok: true, cached: true });
    // cache hits are free for both callers
    expect(usageThisCycle(userA)).toBe(1);
    expect(usageThisCycle(userB)).toBe(0);
  });
});
