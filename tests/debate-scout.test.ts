import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// debate.ts/scout.ts read MCP_*_DAILY_CAP into module consts at import time —
// set them before any module under test is evaluated (vi.hoisted runs first)
vi.hoisted(() => {
  process.env.MCP_DEBATE_DAILY_CAP = '2';
  process.env.MCP_SCOUT_DAILY_CAP = '1';
});

const criticActual = vi.hoisted(() => ({
  runDebate: undefined as typeof import('@/lib/opportunities/critic').runDebate | undefined,
}));

const refineActual = vi.hoisted(() => ({
  refineLeads: undefined as typeof import('@/lib/opportunities/refine').refineLeads | undefined,
}));

// self-contained: runDebate is pinned here while the real multi-role debate
// pipeline is built concurrently in src/lib/opportunities/critic.ts
vi.mock('@/lib/opportunities/critic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/opportunities/critic')>();
  criticActual.runDebate = actual.runDebate;
  return { ...actual, runDebate: vi.fn(), runCritique: vi.fn() };
});

vi.mock('@/lib/opportunities/refine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/opportunities/refine')>();
  refineActual.refineLeads = actual.refineLeads;
  return { ...actual, refineLeads: vi.fn() };
});

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerDebateTools } from '../mcp/tools/debate';
import { registerScoutTools } from '../mcp/tools/scout';
import { registerPrompts } from '../mcp/prompts';
import { runDebate, type DebateResult } from '@/lib/opportunities/critic';
import { refineLeads } from '@/lib/opportunities/refine';
import { _setFetch } from '@/lib/llm/minimax';
import { SUB_KEYS, type OppDraft } from '@/lib/opportunities/engine';
import { persistScoutDrafts } from '@/lib/opportunities/persist-scout';
import { seedWedges } from '@/lib/opportunities/wedges';
import { can } from '@/lib/entitlements';
import { comps, launches, llmCalls, opportunities, painPoints, stories } from '@/lib/db/schema';
import { seedUser, useTestDb } from './helpers/db';

const debateMock = vi.mocked(runDebate);
const refineLeadsMock = vi.mocked(refineLeads);

const PINNED: DebateResult = {
  transcript: [
    { role: 'advocate', text: 'The demand is real and recurring in the pains stream.' },
    { role: 'skeptic', text: 'An incumbent ships this inside two releases.' },
    { role: 'realist', text: 'Comps say the niche clears $20k MRR but no more.' },
    { role: 'judge', text: 'Watch: real opening, named platform risk.' },
  ],
  verdict: 'watch',
  confidence: 55,
  killRisks: ['Shopify ships this natively within two releases'],
  conditionsToSucceed: ['own one niche distribution channel'],
  strengthenedVariants: ['niche down to Shopify Plus sellers', 'usage-based API instead of a dashboard'],
};

function authFor(rateKey: string): AuthContext {
  return { authed: false, userId: null, scopes: new Set(['read', 'plans']), rateKey };
}

function authForUser(userId: number): AuthContext {
  return {
    authed: true,
    userId,
    scopes: new Set(['read', 'plans']),
    rateKey: `user:${userId}`,
  };
}

/** Minimal server with ONLY the two tools under test (never buildServer). */
async function wireWith(auth: AuthContext): Promise<Client> {
  const server = new McpServer({ name: 'debate-scout-test', version: '0.0.1' });
  registerDebateTools(server, auth);
  registerScoutTools(server, auth);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-test', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function wire(rateKey: string): Promise<Client> {
  return wireWith(authFor(rateKey));
}

async function wireUser(userId: number): Promise<Client> {
  return wireWith(authForUser(userId));
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as {
    structuredContent?: Record<string, unknown>;
  };
}

let db: ReturnType<typeof useTestDb>;
const savedKey = process.env.MINIMAX_API_KEY;

beforeEach(() => {
  db = useTestDb();
  debateMock.mockReset();
  debateMock.mockResolvedValue(PINNED);
  refineLeadsMock.mockReset();
  refineLeadsMock.mockResolvedValue({ drafts: [], rejects: [] });
  // chatJSON refuses to call out without a key; the fetch below is mocked anyway
  process.env.MINIMAX_API_KEY = 'test-key';
});

afterEach(() => {
  _setFetch(globalThis.fetch);
  if (savedKey === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = savedKey;
});

const IDEA = 'A dashboard for devtools teams tracking LLM token spend across providers';

function seedDebateGrounding(): void {
  db.insert(painPoints)
    .values({
      summary: 'tracking LLM token spend for devtools teams is painful and manual',
      sector: 'devtools',
      intensity: 4,
      evidence: '[]',
      lastSeenAt: new Date(),
      createdAt: new Date(),
    })
    .run();
  db.insert(comps)
    .values({ kind: 'revenue', product: 'TokenSpendly', amountUsd: 240000, note: '$20k MRR', createdAt: new Date() })
    .run();
  db.insert(launches)
    .values({
      source: 'show-hn',
      title: 'Spendscope',
      url: 'https://example.com/spendscope',
      category: 'ai-coding',
      launchedAt: new Date(),
      createdAt: new Date(),
    })
    .run();
  db.insert(opportunities)
    .values({
      slug: 'llm-spend-tracker',
      title: 'LLM token spend tracker for devtools teams',
      thesis: 'Teams flying blind on LLM token spend keep asking for a tracker; providers will not build cross-vendor views.',
      sector: 'devtools',
      status: 'active',
      flipScore: 60,
      holdScore: 65,
      scores: '{}',
      evidence: '[]',
      verdict: 'watch',
      confidence: 50,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    .run();
}

describe('debate_idea', () => {
  it('runs the debate grounded in pains/comps/launches/closest opportunities', async () => {
    seedDebateGrounding();
    const client = await wire('debate-happy');
    const res = await call(client, 'debate_idea', { idea: IDEA });

    // runDebate got (null, idea + grounding block)
    expect(debateMock).toHaveBeenCalledTimes(1);
    const [oppId, ideaText] = debateMock.mock.calls[0]!;
    expect(oppId).toBeNull();
    expect(ideaText).toContain(IDEA);
    expect(ideaText).toContain('<grounding>');
    expect(ideaText).toContain('<pains>');
    expect(ideaText).toContain('tracking LLM token spend');
    expect(ideaText).toContain('<comps>');
    expect(ideaText).toContain('TokenSpendly');
    expect(ideaText).toContain('<launch-activity-7d>');
    expect(ideaText).toContain('<closest-opportunities>');
    expect(ideaText).toContain('llm-spend-tracker');

    expect(res.structuredContent).toMatchObject({
      ok: true,
      verdict: 'watch',
      confidence: 55,
      kill_risks: ['Shopify ships this natively within two releases'],
      conditions_to_succeed: ['own one niche distribution channel'],
      strengthened_variants: ['niche down to Shopify Plus sellers', 'usage-based API instead of a dashboard'],
    });
    const sc = res.structuredContent!;
    expect((sc.transcript as unknown[]).length).toBe(4);
    const grounding = sc.grounding as string[];
    expect(grounding.some((g) => g.includes('pains'))).toBe(true);
    expect(grounding.some((g) => g.includes('comps'))).toBe(true);
    expect(grounding.some((g) => g.includes('launch activity'))).toBe(true);
    expect(grounding.some((g) => g.includes('llm-spend-tracker'))).toBe(true);
    expect(sc.summary as string).toContain('watch');
    // watch verdict → scout hint; closest slug exists → generate_plan hint
    const next = sc.next as { tool: string; reason: string }[];
    expect(next.some((n) => n.tool === 'scout_opportunities')).toBe(true);
    const plan = next.find((n) => n.tool === 'generate_plan');
    expect(plan).toBeDefined();
    expect(plan!.reason).toContain('llm-spend-tracker');
  });

  it('returns ok:false (never throws) when the debate pipeline fails', async () => {
    debateMock.mockRejectedValueOnce(new Error('LLM down'));
    const client = await wire('debate-fails');
    const res = await call(client, 'debate_idea', { idea: IDEA });
    expect(res.structuredContent).toMatchObject({ ok: false });
    expect(res.structuredContent!.error as string).toContain('LLM down');
  });

  it('refuses after MCP_DEBATE_DAILY_CAP calls — every call counts', async () => {
    const client = await wire('debate-cap');
    const first = await call(client, 'debate_idea', { idea: IDEA });
    const second = await call(client, 'debate_idea', { idea: IDEA });
    const third = await call(client, 'debate_idea', { idea: IDEA });
    expect(first.structuredContent).toMatchObject({ ok: true });
    expect(second.structuredContent).toMatchObject({ ok: true });
    expect(third.structuredContent).toMatchObject({ ok: false });
    expect(third.structuredContent!.error as string).toContain('daily debate cap reached (2)');
    expect(debateMock).toHaveBeenCalledTimes(2); // the refusal never reaches the LLM
  });

  it('writes llm_calls rows tagged debate for the signed-in user', async () => {
    seedUser(db, 1);
    debateMock.mockImplementation(criticActual.runDebate!);
    const payloads = [
      { text: 'The demand is proven: three recurring pains name this gap and prices fell this quarter so a focused API undercuts incumbents.' },
      { text: 'An incumbent ships this inside two releases and the advocate overstates how long the window stays open for a newcomer.' },
      { text: 'The comps show per-image tools exiting at 3-5x ARR, launch activity is up, and current model prices do support the stated margin.' },
      {
        verdict: 'watch',
        confidence: 55,
        reasoning: 'Demand evidence is real but platform risk is named and not yet mitigated by positioning.',
        killRisks: ['Shopify ships this natively within two releases'],
        conditionsToSucceed: ['own one niche distribution channel'],
        strengthenedVariants: ['niche down to Shopify Plus sellers', 'usage-based API instead of a dashboard'],
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

    const client = await wireUser(1);
    const res = await call(client, 'debate_idea', { idea: IDEA });
    expect(res.structuredContent).toMatchObject({ ok: true });

    const rows = db.select().from(llmCalls).all();
    expect(rows.some((r) => r.feature === 'debate' && r.userId === 1)).toBe(true);
  });
});

// --- scout_opportunities ---

function seedSignals(): void {
  seedWedges();
  for (let i = 0; i < 5; i++) {
    db.insert(painPoints)
      .values({
        summary: `paid need number ${i} that keeps recurring for engineering teams`,
        intensity: 2,
        evidence: '[]',
        lastSeenAt: new Date(),
        createdAt: new Date(),
      })
      .run();
    db.insert(stories)
      .values({ title: `signal story ${i}`, tldr: 'tldr', status: 'curated', topScore: 80, createdAt: new Date() })
      .run();
  }
}

const draft = (slug: string) => ({
  slug,
  title: `Opening ${slug} for solo builders`,
  thesis: 'A thesis long enough to pass the thirty character validation rule, citing the pains.',
  sector: 'coding',
  window: '6-9 months',
  windowMonths: 8,
  subScores: Object.fromEntries(SUB_KEYS.map((k) => [k, 12])),
  kpis: { initialCostUsd: 300, monthlyCostUsd: 40, priceUsd: 29, timeToMvpDays: 10, breakEvenCustomers: 2, competitorCount: 1 },
  evidenceRefs: ['P1'],
});

function asOppDraft(slug: string): OppDraft {
  const d = draft(slug);
  return {
    slug: d.slug,
    title: d.title,
    thesis: d.thesis,
    sector: d.sector,
    window: d.window,
    windowMonths: d.windowMonths,
    sub: d.subScores as OppDraft['sub'],
    kpis: {
      ...d.kpis,
      competitionNote: null,
      regulatoryNote: null,
    },
    evidenceRefs: d.evidenceRefs,
  };
}

function persistDraft(slug: string): OppDraft {
  return {
    slug,
    title: `Title for ${slug}`,
    thesis: 'A sufficiently long thesis to satisfy the sanitizer and the gate.',
    sector: 'devtools',
    window: '6 months',
    windowMonths: 6,
    sub: Object.fromEntries(SUB_KEYS.map((k) => [k, 12])) as OppDraft['sub'],
    kpis: {
      initialCostUsd: 100,
      monthlyCostUsd: 50,
      priceUsd: 30,
      timeToMvpDays: 14,
      breakEvenCustomers: 5,
      competitorCount: 3,
      competitionNote: null,
      regulatoryNote: null,
    },
    evidenceRefs: ['P1'],
  };
}

/** Mock MiniMax: proposer returns the given drafts; captures request bodies. */
function mockProposer(drafts: unknown[]): { bodies: { system: string; user: string }[] } {
  const bodies: { system: string; user: string }[] = [];
  _setFetch((async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { content: string }[] };
    bodies.push({ system: body.messages[0]!.content, user: body.messages[1]!.content });
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ openings: drafts }) } }],
        usage: {},
      }),
    } as Response;
  }) as unknown as typeof fetch);
  return { bodies };
}

describe('scout_opportunities', () => {
  it('returns fresh openings, filters existing slugs, lands constraints in the prompt', async () => {
    seedSignals();
    db.insert(opportunities)
      .values({
        slug: 'existing-opening',
        title: 'Already tracked',
        thesis: 'This one is already an active opportunity in the DB.',
        status: 'active',
        flipScore: 50,
        holdScore: 50,
        scores: '{}',
        evidence: '[]',
        verdict: 'watch',
        confidence: 40,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })
      .run();
    refineLeadsMock.mockResolvedValue({
      drafts: [asOppDraft('existing-opening'), asOppDraft('fresh-one'), asOppDraft('fresh-two')],
      rejects: [],
    });

    const client = await wire('scout-happy');
    const res = await call(client, 'scout_opportunities', {
      skills: 'typescript, nextjs',
      hoursPerWeek: 10,
      riskAppetite: 'medium',
    });

    expect(res.structuredContent).toMatchObject({ ok: true, skipped_existing: 1 });
    const openings = res.structuredContent!.openings as {
      slug: string;
      title: string;
      sub_scores: Record<string, number>;
      kpis: { initialCostUsd: number | null };
      evidence_refs: string[];
      sector: string | null;
    }[];
    expect(openings.map((o) => o.slug)).toEqual(['fresh-one', 'fresh-two']);
    expect(openings[0]!.sub_scores.demand).toBe(12);
    expect(openings[0]!.kpis.initialCostUsd).toBe(300);
    expect(openings[0]!.evidence_refs).toEqual(['P1']);
    expect(openings[0]!.sector).toBe('coding');

    expect(refineLeadsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'scout',
        constraints: expect.objectContaining({
          skills: 'typescript, nextjs',
          hoursPerWeek: 10,
          riskAppetite: 'medium',
        }),
      }),
    );

    // anonymous callers get drafts back but nothing is persisted — generate_plan
    // is only offered when a row actually landed for the caller
    const next = res.structuredContent!.next as { tool: string; reason: string }[];
    expect(next[0]!.tool).toBe('debate_idea');
    expect(next.find((n) => n.tool === 'generate_plan')).toBeUndefined();
    expect(openings).toEqual(expect.arrayContaining([expect.objectContaining({ persisted: false })]));
  });

  it('politely refuses with ok:false when the scope is too thin (no LLM call)', async () => {
    const { bodies } = mockProposer([]);
    const client = await wire('scout-thin');
    const res = await call(client, 'scout_opportunities', {});
    expect(res.structuredContent).toMatchObject({ ok: false, openings: [], skipped_existing: 0 });
    expect(res.structuredContent!.error as string).toContain('too thin');
    expect(bodies).toHaveLength(0);
  });

  it('refuses after MCP_SCOUT_DAILY_CAP calls', async () => {
    seedSignals();
    refineLeadsMock.mockResolvedValue({ drafts: [asOppDraft('fresh-one')], rejects: [] });
    const client = await wire('scout-cap');
    const first = await call(client, 'scout_opportunities', {});
    const second = await call(client, 'scout_opportunities', {});
    expect(first.structuredContent).toMatchObject({ ok: true });
    expect(second.structuredContent).toMatchObject({ ok: false, openings: [] });
    expect(second.structuredContent!.error as string).toContain('daily scout cap reached (1)');
    expect(refineLeadsMock).toHaveBeenCalledTimes(1); // the refusal never reaches the refiner
  });

  it('does not starve a second owner when another caller already holds the slug', async () => {
    seedUser(db, 1);
    seedUser(db, 2);
    seedSignals();
    persistScoutDrafts([persistDraft('shared-idea')], 1);
    refineLeadsMock.mockResolvedValue({ drafts: [asOppDraft('shared-idea')], rejects: [] });

    const client = await wireUser(2);
    const res = await call(client, 'scout_opportunities', {});
    expect(res.structuredContent).toMatchObject({ ok: true, skipped_existing: 0 });
    const openings = res.structuredContent!.openings as { slug: string; persisted?: boolean }[];
    expect(openings.map((o) => o.slug)).toContain('shared-idea');
    expect(openings).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: 'shared-idea', persisted: true })]),
    );
  });

  it('meters a signed-in scout against the scout quota, not lead_refine', async () => {
    seedUser(db, 7);
    seedSignals();
    refineLeadsMock.mockImplementation(refineActual.refineLeads!);
    mockProposer([]);

    expect(can({ id: 7 }, 'scout').used ?? 0).toBe(0);
    const client = await wireUser(7);
    const res = await call(client, 'scout_opportunities', {});
    expect(res.structuredContent).toMatchObject({ ok: true });
    expect(can({ id: 7 }, 'scout').used).toBe(1);
    expect(can({ id: 7 }, 'lead_refine').used ?? 0).toBe(0);
  });
});

describe('validate_idea prompt', () => {
  it('delegates to debate_idea and keeps the { idea } arg contract', async () => {
    const server = new McpServer({ name: 'prompt-test', version: '0.0.1' });
    registerPrompts(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'mcp-test', version: '0.0.1' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const prompt = await client.getPrompt({ name: 'validate_idea', arguments: { idea: 'test idea' } });
    expect(prompt.messages).toHaveLength(1);
    const text = (prompt.messages[0]!.content as { text: string }).text;
    expect(text).toContain('debate_idea');
    expect(text).toContain('test idea');
    expect(text).not.toContain('get_pain_points'); // the old 5-tool walkthrough is gone
  });
});
