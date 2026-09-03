import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { _setFetch } from '@/lib/llm/minimax';
import { runDebate } from '@/lib/opportunities/critic';
import { runOpportunities, SUB_KEYS } from '@/lib/opportunities/engine';
import { generatePlan } from '@/lib/plans/generate';
import { debates, llmCalls, opportunities, painPoints, stories } from '@/lib/db/schema';
import { seedUser, useTestDb } from './helpers/db';

const authHooks = vi.hoisted(() => ({
  currentUser: null as { id: number; name: string; role: 'admin' | 'member' } | null,
}));
vi.mock('@/lib/auth/user', () => ({
  requireApiUser: vi.fn(async () => authHooks.currentUser),
  getCurrentUser: vi.fn(async () => authHooks.currentUser),
  requireViewer: vi.fn(async () => authHooks.currentUser),
}));

import { POST as debatesPost } from '@/app/api/debates/route';

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

const USAGE = { prompt_tokens: 100, completion_tokens: 50 };

/** Mock fetch answering each chat completion with the next queued payload. */
function mockQueue(payloads: unknown[]): void {
  _setFetch((async () => {
    const payload = payloads.shift();
    if (payload === undefined) throw new Error('unexpected extra LLM call in test');
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: USAGE }),
    } as Response;
  }) as unknown as typeof fetch);
}

// --- the four role payloads (advocate → skeptic → realist → judge) ---

const ADVOCATE = {
  text: 'The demand is proven: three recurring pains name batch image editing, and image model prices fell 10x this quarter, so a focused API undercuts incumbents on day one.',
};
const SKEPTIC = {
  text: 'Shopify ships this natively within two releases and remove.bg already owns the batch niche; the advocate overstates how long the window stays open.',
  killRisks: ['Shopify ships this natively'],
};
const REALIST = {
  text: 'The comps show per-image tools exiting at 3-5x ARR, launch activity in the category is up, and current model prices do support the stated margin — the economics check out.',
};
const JUDGE = {
  verdict: 'pursue',
  confidence: 78,
  reasoning:
    'Demand evidence is multi-source and the economics close inside the window; platform risk is real but mitigated by the API-first positioning.',
  killRisks: ['Shopify ships this natively within two releases', 'remove.bg price response'],
  conditionsToSucceed: ['ship the bulk API before the next Shopify release', 'win 3 anchor e-commerce accounts'],
  strengthenedVariants: [
    'Verticalize: Shopify-only bulk editor with one-click publish',
    'Usage-credit pricing aimed at design agencies',
    'White-label the API for print-on-demand platforms',
  ],
};
const ROLE_PAYLOADS = [ADVOCATE, SKEPTIC, REALIST, JUDGE];

const BRIEF_JSON = {
  icp: 'E-commerce operators with large catalogs who pay per-image editors',
  mvp: ['upload API', 'background removal worker', 'credit billing'],
  stackVenture: 'ai-product',
  stackNotes: null,
  unitEconomics: { assumptions: ['test'], monthlyCostUsd: 40, suggestedPriceUsd: 29, breakEvenCustomers: 2 },
  gtm: ['shopify app store'],
  risks: ['platform dependency'],
};

function seedOpportunity(withBrief = false): number {
  db.insert(opportunities)
    .values({
      slug: 'bulk-bg-removal-api',
      title: 'Bulk background-removal API',
      thesis: 'Sellers need cheap bulk background removal; new image models make it 10x cheaper to offer.',
      sector: 'image',
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

describe('runDebate', () => {
  it('runs the four roles in order and returns the pinned shape', async () => {
    const oppId = seedOpportunity();
    mockQueue([...ROLE_PAYLOADS]);

    const res = await runDebate(oppId);

    expect(res.transcript.map((t) => t.role)).toEqual(['advocate', 'skeptic', 'realist', 'judge']);
    expect(res.transcript[0]!.text).toBe(ADVOCATE.text);
    expect(res.transcript[1]!.text).toBe(SKEPTIC.text);
    expect(res.transcript[2]!.text).toBe(REALIST.text);
    expect(res.transcript[3]!.text).toBe(JUDGE.reasoning);
    expect(res.verdict).toBe('pursue');
    expect(res.confidence).toBe(78);
    expect(res.killRisks).toEqual(JUDGE.killRisks);
    expect(res.conditionsToSucceed).toEqual(JUDGE.conditionsToSucceed);
    expect(res.strengthenedVariants).toHaveLength(3);

    // one metered llm_calls row per role, all tagged feature='debate'
    const rows = db.select().from(llmCalls).all();
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.feature === 'debate')).toBe(true);
  });

  it('persists exactly one debates row with verdict + confidence', async () => {
    const oppId = seedOpportunity();
    mockQueue([...ROLE_PAYLOADS]);

    await runDebate(oppId);

    const rows = db.select().from(debates).all();
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.opportunityId).toBe(oppId);
    expect(r.ideaText).toBeNull();
    expect(r.verdict).toBe('pursue');
    expect(r.confidence).toBe(78);
    const transcript = JSON.parse(r.transcript) as Record<string, unknown>[];
    expect(transcript.map((t) => t.role)).toEqual(['advocate', 'skeptic', 'realist', 'judge']);
    // the judge's turn carries the structured outcome for the dossier page
    expect(transcript[3]!.killRisks).toEqual(JUDGE.killRisks);
    expect(transcript[3]!.conditionsToSucceed).toEqual(JUDGE.conditionsToSucceed);
    expect(transcript[3]!.strengthenedVariants).toHaveLength(3);
  });

  it('debates a free-text idea when oppId is null', async () => {
    mockQueue([...ROLE_PAYLOADS]);

    const res = await runDebate(
      null,
      'A subscription service turning podcast archives into searchable, SEO-friendly show-notes pages for indie podcasters',
    );

    expect(res.verdict).toBe('pursue');
    expect(res.transcript).toHaveLength(4);
    const r = db.select().from(debates).all()[0]!;
    expect(r.opportunityId).toBeNull();
    expect(r.ideaText).toContain('podcast');
  });

  it('records the requesting user as owner and returns the row id', async () => {
    seedUser(db, 7);
    mockQueue([...ROLE_PAYLOADS]);

    const res = await runDebate(
      null,
      'A subscription service turning podcast archives into searchable, SEO-friendly show-notes pages for indie podcasters',
      7,
    );

    const r = db.select().from(debates).all()[0]!;
    expect(r.ownerId).toBe(7);
    expect(res.id).toBe(r.id);
  });

  it('leaves owner null for engine-run debates', async () => {
    const oppId = seedOpportunity();
    mockQueue([...ROLE_PAYLOADS]);

    await runDebate(oppId);

    expect(db.select().from(debates).all()[0]!.ownerId).toBeNull();
  });

  it('throws when a role fails mid-pipeline and persists nothing', async () => {
    const oppId = seedOpportunity();
    mockQueue([ADVOCATE, SKEPTIC, { nope: true }]); // realist returns garbage

    await expect(runDebate(oppId)).rejects.toThrow(/realist returned no usable text/);
    expect(db.select().from(debates).all()).toHaveLength(0);
  });

  it('rejects when neither subject is given', async () => {
    await expect(runDebate(null)).rejects.toThrow(/substantive idea text/);
    await expect(runDebate(null, '   ')).rejects.toThrow(/substantive idea text/);
    await expect(runDebate(999)).rejects.toThrow('opportunity 999 not found'); // missing opportunity
  });
});

// --- POST /api/debates error mapping (3.8a) ---

describe('POST /api/debates', () => {
  const MEMBER = { id: 1, name: 'member', role: 'member' as const };

  function jsonReq(body: unknown): Request {
    return new Request('http://localhost/api/debates', { method: 'POST', body: JSON.stringify(body) });
  }

  it('401 when signed out', async () => {
    authHooks.currentUser = null;
    const res = await debatesPost(jsonReq({ idea: 'A subscription service turning podcast archives into show-notes' }));
    expect(res.status).toBe(401);
  });

  it('400 with a stable message when neither idea nor opportunityId is given', async () => {
    authHooks.currentUser = MEMBER;
    const res = await debatesPost(jsonReq({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'idea or opportunityId required' });
  });

  it('400 when the idea is too thin to debate (domain validation)', async () => {
    authHooks.currentUser = MEMBER;
    const res = await debatesPost(jsonReq({ idea: 'short' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('substantive idea text');
  });

  it('404 when the opportunity does not exist', async () => {
    authHooks.currentUser = MEMBER;
    const res = await debatesPost(jsonReq({ opportunityId: 999 }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('opportunity 999 not found');
  });

  it('500 with a generic body when the LLM provider fails — no internals leak', async () => {
    authHooks.currentUser = MEMBER;
    // provider 4xx: non-retryable LlmError whose message names provider internals
    _setFetch((async () => ({ ok: false, status: 400 }) as Response) as unknown as typeof fetch);

    const res = await debatesPost(
      jsonReq({ idea: 'A subscription service turning podcast archives into searchable show-notes pages' }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'internal' });
    expect(JSON.stringify(body)).not.toContain('MiniMax');
    expect(JSON.stringify(body)).not.toContain('HTTP 400');
  });
});

// --- engine auto-run (9a) ---

function seedSignal() {
  for (let i = 0; i < 3; i++) {
    db.insert(painPoints)
      .values({ summary: `paid need number ${i} that keeps recurring`, intensity: 2, evidence: '[]', lastSeenAt: new Date(), createdAt: new Date() })
      .run();
    db.insert(stories)
      .values({ title: `signal story ${i}`, tldr: 'tldr', status: 'curated', topScore: 80, createdAt: new Date() })
      .run();
  }
}

const draft = (slug: string, score: number) => ({
  slug,
  title: `Opening ${slug} with a long enough title`,
  thesis: `Thesis for ${slug}: demand is recurring, the tooling gap is real, and nobody ships the fix yet.`,
  sector: 'image',
  window: '6-9 months',
  subScores: Object.fromEntries(SUB_KEYS.map((k) => [k, score])),
  kpis: { initialCostUsd: 250, timeToMvpDays: 9 },
  evidenceRefs: ['P1'],
});

/** Content-dispatched mock: proposer → critic → per-role debate payloads. */
function mockEngineLlm(judgePayload: unknown = JUDGE): void {
  _setFetch((async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { content: string }[] };
    const system = body.messages[0]!.content;
    let payload: unknown;
    if (system.includes('opportunity scout')) {
      // doomed-opening scores highest but the critic rejects it — it must be
      // excluded from the debate auto-run despite topping the ranking
      payload = { opportunities: [draft('top-opening', 18), draft('mid-opening', 14), draft('doomed-opening', 19)] };
    } else if (system.includes('red-team reviewer')) {
      payload = {
        reviews: [
          { slug: 'top-opening', verdict: 'pursue', confidence: 80, killRisks: [], axisAdjustments: [], coherenceFlags: [] },
          { slug: 'mid-opening', verdict: 'watch', confidence: 60, killRisks: [], axisAdjustments: [], coherenceFlags: [] },
          { slug: 'doomed-opening', verdict: 'reject', confidence: 25, killRisks: ['economics underwater'], axisAdjustments: [], coherenceFlags: [] },
        ],
      };
    } else if (system.includes('ADVOCATE')) {
      payload = ADVOCATE;
    } else if (system.includes('SKEPTIC')) {
      payload = SKEPTIC;
    } else if (system.includes('MARKET REALIST')) {
      payload = REALIST;
    } else if (system.includes('JUDGE')) {
      payload = judgePayload;
    } else {
      throw new Error('unexpected LLM call in test');
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: USAGE }),
    } as Response;
  }) as unknown as typeof fetch);
}

describe('runOpportunities debate auto-run', () => {
  it('debates only the top-K new non-reject opportunities and counts them', async () => {
    seedSignal();
    mockEngineLlm();

    const res = await runOpportunities();

    expect(res.created).toBe(3);
    expect(res.debated).toBe(2); // TOP_K_DEBATES
    const slugById = new Map(db.select().from(opportunities).all().map((o) => [o.id, o.slug]));
    const debatedSlugs = db
      .select()
      .from(debates)
      .all()
      .map((r) => slugById.get(r.opportunityId!))
      .sort();
    // the rejected opening tops the flipScore ranking but gets no debate
    expect(debatedSlugs).toEqual(['mid-opening', 'top-opening']);
    expect(db.select().from(opportunities).where(eq(opportunities.slug, 'doomed-opening')).get()!.verdict).toBe('reject');

    // 1 proposer + 1 critic + 2 debates x 4 roles
    const features = db.select().from(llmCalls).all().map((r) => r.feature);
    expect(features.filter((f) => f === 'debate')).toHaveLength(8);
    expect(features.filter((f) => f === 'opportunity')).toHaveLength(1);
    expect(features.filter((f) => f === 'critic')).toHaveLength(1);
  });

  it('a failing debate never fails the job', async () => {
    seedSignal();
    mockEngineLlm({ verdict: 'pursue' }); // judge without reasoning → debate throws

    const res = await runOpportunities();

    expect(res.created).toBe(3);
    expect(res.debated).toBe(0);
    expect(db.select().from(debates).all()).toHaveLength(0);
  });
});

// --- planRuns crowdedness counter (9e), mirrors tests/llm-calls.test.ts ---

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

/** Content-dispatched MiniMax mock: frame → per-phase (brief is pre-cached). */
function mockPlanLlm(): void {
  _setFetch((async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { content: string }[] };
    const user = body.messages[1]!.content;
    let payload: unknown;
    if (user.includes('plan frame')) {
      payload = FRAME_JSON;
    } else {
      const m = /Write the "(\w+)" phase/.exec(user);
      if (!m) throw new Error('unexpected LLM call in test');
      payload = phaseJson(m[1]!);
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: USAGE }),
    } as Response;
  }) as unknown as typeof fetch);
}

function planRuns(oppId: number): number {
  return db.select({ n: opportunities.planRuns }).from(opportunities).where(eq(opportunities.id, oppId)).get()!.n;
}

describe('planRuns crowdedness counter', () => {
  it('increments on fresh generation, not on a cached read', async () => {
    const oppId = seedOpportunity(true); // cached brief → frame + 5 phases only
    mockPlanLlm();

    const first = await generatePlan(oppId);
    expect(first.ok).toBe(true);
    expect(first.ok && first.cached).toBe(false);
    expect(planRuns(oppId)).toBe(1);

    const second = await generatePlan(oppId);
    expect(second.ok).toBe(true);
    expect(second.ok && second.cached).toBe(true);
    expect(planRuns(oppId)).toBe(1); // cache hit does not increment
  });
});
