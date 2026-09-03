import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { admitPlanGeneration, usageThisCycle } from '@/lib/billing';
import { can } from '@/lib/entitlements';
import { llmCalls, opportunities } from '@/lib/db/schema';
import { _setFetch } from '@/lib/llm/minimax';
import { generatePlan } from '@/lib/plans/generate';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

// 3.3a: a plan generation that fails after the frame call must not consume
// quota — the frame's metered row is re-tagged feature='plan-failed' (kept
// for cost attribution) and any reserved admission slot is handed back.

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

function seedOpportunity(db: Db): number {
  return db
    .insert(opportunities)
    .values({
      slug: 'bulk-bg-removal-api',
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

function features(db: Db, userId: number): string[] {
  return db
    .select({ feature: llmCalls.feature })
    .from(llmCalls)
    .where(eq(llmCalls.userId, userId))
    .all()
    .map((r) => r.feature);
}

describe('failed plan generation quota compensation', () => {
  let db: Db;
  let userId: number;
  let oppId: number;

  beforeEach(() => {
    db = useTestDb();
    userId = seedUser(db);
    oppId = seedOpportunity(db);
    process.env.MINIMAX_API_KEY = 'test-key';
  });

  it('failing at phase 2 leaves usageThisCycle unchanged and re-tags the frame row', async () => {
    const { calls } = mockMinimax({ failBuild: true });

    const res = await generatePlan(oppId, { userId });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('phase "build"');

    // no quota consumed — the gate sees the user as untouched
    expect(usageThisCycle(userId)).toBe(0);
    expect(can({ id: userId }, 'plan')).toMatchObject({ ok: true, used: 0, quota: 3 });

    // the frame row stays for cost attribution, re-tagged off the quota feature;
    // successful phase calls (validation + both build attempts) stay metered too
    const feats = features(db, userId);
    expect(feats).not.toContain('plan');
    expect(feats.filter((f) => f === 'plan-failed')).toHaveLength(1);
    expect(feats.filter((f) => f === 'plan-phase')).toHaveLength(3);
    expect(feats).toContain('opportunity-brief');
    // brief + frame + validation + 2 build attempts
    expect(calls).toHaveLength(5);
  });

  it('a failed generation also releases the reserved admission slot', async () => {
    mockMinimax({ failBuild: true });
    const admission = admitPlanGeneration(userId);
    expect(admission.ok).toBe(true);
    expect(usageThisCycle(userId)).toBe(1); // slot held

    const res = await generatePlan(oppId, { userId, admissionId: admission.admissionId });
    expect(res.ok).toBe(false);
    expect(usageThisCycle(userId)).toBe(0); // admission released, frame re-tagged
    expect(features(db, userId)).not.toContain('plan');
  });

  it('a successful generation with admission consumes exactly one quota unit', async () => {
    mockMinimax();
    const admission = admitPlanGeneration(userId);

    const res = await generatePlan(oppId, { userId, admissionId: admission.admissionId });
    expect(res.ok).toBe(true);

    // the placeholder was swapped for the frame's metered row, not double-counted
    expect(usageThisCycle(userId)).toBe(1);
    expect(features(db, userId).filter((f) => f === 'plan')).toHaveLength(1);
  });

  it('a cache hit releases the admission slot without consuming quota', async () => {
    mockMinimax();
    const first = await generatePlan(oppId, { userId });
    expect(first.ok).toBe(true);
    expect(usageThisCycle(userId)).toBe(1);

    const admission = admitPlanGeneration(userId);
    expect(usageThisCycle(userId)).toBe(2); // slot held on top of the finished generation

    const res = await generatePlan(oppId, { userId, admissionId: admission.admissionId });
    expect(res).toMatchObject({ ok: true, cached: true });
    expect(usageThisCycle(userId)).toBe(1); // cache hit wrote nothing and released the slot
  });
});
