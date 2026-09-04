import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { _setFetch, chatJSON } from '@/lib/llm/minimax';
import { UNMETERED_COST_USD, estimateCostUsd } from '@/lib/llm/pricing';
import { generatePlan } from '@/lib/plans/generate';
import { llmCalls, opportunities } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;

const savedEnv = { key: process.env.MINIMAX_API_KEY, model: process.env.MINIMAX_MODEL };

beforeEach(() => {
  db = useTestDb();
  // chatJSON refuses to call out without a key; the fetch below is mocked anyway
  process.env.MINIMAX_API_KEY = 'test-key';
  // pin the model so assertions don't depend on the developer's shell env
  delete process.env.MINIMAX_MODEL;
});

afterEach(() => {
  _setFetch(globalThis.fetch);
  if (savedEnv.key === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = savedEnv.key;
  if (savedEnv.model === undefined) delete process.env.MINIMAX_MODEL;
  else process.env.MINIMAX_MODEL = savedEnv.model;
});

/** Mock fetch answering every chat completion with the given payload + usage. */
function mockCompletion(payload: unknown, usage = { prompt_tokens: 2100, completion_tokens: 1500 }): void {
  _setFetch((async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage }),
  })) as unknown as typeof fetch);
}

describe('estimateCostUsd', () => {
  it('prices MiniMax-M2 at $0.30 in / $1.20 out per 1M tokens', () => {
    // 2100/1e6*0.30 + 1500/1e6*1.20 = 0.00243
    expect(estimateCostUsd('MiniMax-M2', 2100, 1500)).toBeCloseTo(0.00243, 12);
    expect(estimateCostUsd('MiniMax-M2', 0, 0)).toBe(0);
  });

  it('prices MiniMax-M3 at the same $0.30 in / $1.20 out (standard ≤512k)', () => {
    expect(estimateCostUsd('MiniMax-M3', 2100, 1500)).toBeCloseTo(0.00243, 12);
  });

  it('returns the unmetered sentinel for unmapped models — never a silent 0', () => {
    // JUSTIFICATION (G1): unmapped models used to estimate as 0, under-reporting
    // money with no signal. The sentinel lets usage aggregates count the calls
    // as unmetered instead of summing them as $0.
    expect(estimateCostUsd('No-Such-Model', 1_000_000, 1_000_000)).toBe(UNMETERED_COST_USD);
  });
});

describe('chatJSON metering', () => {
  it('writes exactly one llm_calls row with feature/userId/model/tokens/cost on success', async () => {
    mockCompletion({ ok: true });
    const out = await chatJSON<{ ok: boolean }>('sys', 'user', { feature: 'x', userId: 42 });
    expect(out.ok).toBe(true);

    const rows = db.select().from(llmCalls).all();
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.feature).toBe('x');
    expect(r.userId).toBe(42);
    expect(r.job).toBeNull();
    expect(r.model).toBe('MiniMax-M3');
    expect(r.promptTokens).toBe(2100);
    expect(r.completionTokens).toBe(1500);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.estCostUsd).toBeCloseTo(0.00243, 12);
    expect(r.ts).toBeInstanceOf(Date);
    expect(Math.abs(Date.now() - r.ts.getTime())).toBeLessThan(60_000);
  });

  it("defaults feature to 'unknown' and userId to null", async () => {
    mockCompletion({ ok: true });
    await chatJSON('sys', 'user');
    const rows = db.select().from(llmCalls).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.feature).toBe('unknown');
    expect(rows[0]!.userId).toBeNull();
  });

  it('meters nothing when the call fails', async () => {
    _setFetch((async () => ({ ok: false, status: 400 })) as unknown as typeof fetch);
    await expect(chatJSON('sys', 'user', { feature: 'x', userId: 42 })).rejects.toThrow('MiniMax HTTP 400');
    expect(db.select().from(llmCalls).all()).toHaveLength(0);
  });

  it('meters the unmetered sentinel when the configured model is unmapped', async () => {
    // JUSTIFICATION (G1): was "estimates 0 cost" — unmapped models now write
    // the unmetered sentinel so the call surfaces in the unmetered counters.
    process.env.MINIMAX_MODEL = 'No-Such-Model';
    mockCompletion({ ok: true });
    await chatJSON('sys', 'user', { feature: 'x' });
    const rows = db.select().from(llmCalls).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.model).toBe('No-Such-Model');
    expect(rows[0]!.estCostUsd).toBe(UNMETERED_COST_USD);
  });
});

// --- userId threading through plan generation (mirrors tests/mcp-tools.test.ts) ---

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

/** Content-dispatched MiniMax mock: brief → frame → per-phase, each with token usage. */
function mockMinimax(): void {
  _setFetch((async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { content: string }[] };
    const system = body.messages[0]!.content;
    const user = body.messages[1]!.content;
    let payload: unknown;
    if (system.includes('launch brief')) {
      payload = BRIEF_JSON;
    } else if (user.includes('plan frame')) {
      payload = FRAME_JSON;
    } else {
      const m = /Write the "(\w+)" phase/.exec(user);
      if (!m) throw new Error('unexpected LLM call in test');
      payload = phaseJson(m[1]!);
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(payload) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as Response;
  }) as unknown as typeof fetch);
}

function seedOpportunity(withBrief = false): number {
  db.insert(opportunities)
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
      ...(withBrief ? { brief: JSON.stringify(BRIEF_JSON), briefGeneratedAt: new Date() } : {}),
    })
    .run();
  return db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(eq(opportunities.slug, 'bulk-bg-removal-api'))
    .get()!.id;
}

describe('generatePlan userId threading', () => {
  it('meters brief + frame + 5 phases with userId and per-feature tags (no cached brief)', async () => {
    const oppId = seedOpportunity();
    mockMinimax();

    const res = await generatePlan(oppId, { userId: 42 });
    expect(res.ok).toBe(true);

    const rows = db.select().from(llmCalls).all();
    // insertion order is generation order: brief, frame, validation, build, launch, gtm, revenue
    expect(rows).toHaveLength(7);
    for (const r of rows) {
      expect(r.userId).toBe(42);
      expect(r.model).toBe('MiniMax-M3');
      // 100/1e6*0.30 + 50/1e6*1.20 = 0.00009 per call
      expect(r.estCostUsd).toBeCloseTo(0.00009, 12);
    }
    expect(rows[0]!.feature).toBe('opportunity-brief');
    // frame is the single 'plan' row per generation (billing counts these);
    // the five phase calls tag as 'plan-phase'
    expect(rows[1]!.feature).toBe('plan');
    expect(rows.slice(2).every((r) => r.feature === 'plan-phase')).toBe(true);
  });

  it('meters frame + 5 phases only when the brief is already cached', async () => {
    const oppId = seedOpportunity(true);
    mockMinimax();

    const res = await generatePlan(oppId, { userId: 42 });
    expect(res.ok).toBe(true);

    const rows = db.select().from(llmCalls).all();
    expect(rows).toHaveLength(6);
    expect(rows[0]!.feature).toBe('plan');
    expect(rows.slice(1).every((r) => r.feature === 'plan-phase')).toBe(true);
    expect(rows.every((r) => r.userId === 42)).toBe(true);
  });
});
