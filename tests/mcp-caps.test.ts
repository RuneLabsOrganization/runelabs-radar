import { beforeEach, describe, expect, it, vi } from 'vitest';

// plans.ts/ask.ts read MCP_PLAN_DAILY_CAP / MCP_ASK_DAILY_CAP into module
// consts at import time — set them before any module under test is evaluated
// (vi.hoisted runs first)
vi.hoisted(() => {
  process.env.MCP_PLAN_DAILY_CAP = '1';
  process.env.MCP_ASK_DAILY_CAP = '1';
});

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { AuthContext } from '../mcp/lib/auth';
import type { Db } from '@/lib/db';

// 3.2e: the anonymous plan/ask daily caps live in usage_counters (scout
// pattern), not module-level Maps — they survive deploys/replicas and stale
// keys are swept by gcCounters.
//
// Every stateful module is imported DYNAMICALLY: these tests call
// vi.resetModules() to simulate a redeploy, and a static import would keep
// pointing at the pre-reset module instance (and its stale db singleton).

const ANON: AuthContext = {
  authed: false,
  userId: null,
  scopes: new Set(['read', 'plans']),
  rateKey: 'anon-caps',
};

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

/** The current module graph — one dynamic import site so every helper agrees on the instance. */
async function graph() {
  const [dbMod, schema, counters, minimax, pool] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('@/lib/usage/counters'),
    import('@/lib/llm/minimax'),
    import('@/lib/opportunities/pool'),
  ]);
  return { dbMod, schema, counters, minimax, pool };
}

function mockMinimax(calls: string[], setFetch: (f: typeof fetch) => void): void {
  setFetch((async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { content: string }[] };
    const system = body.messages[0]!.content;
    const user = body.messages[1]!.content;
    let payload: unknown;
    if (system.includes('synthesis brief')) {
      payload = { answer: 'Grounded answer from live data.', confidence: 80, citations: [], next_tools: [] };
      calls.push('ask');
    } else if (system.includes('launch brief')) {
      payload = BRIEF_JSON;
      calls.push('brief');
    } else if (user.includes('plan frame')) {
      payload = FRAME_JSON;
      calls.push('frame');
    } else {
      const m = /Write the "(\w+)" phase/.exec(user);
      if (!m) throw new Error('unexpected LLM call in test');
      payload = phaseJson(m[1]!);
      calls.push(`phase:${m[1]}`);
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: {} }),
    } as Response;
  }) as unknown as typeof fetch);
}

async function wire(auth: AuthContext): Promise<Client> {
  const { buildServer } = await import('../mcp/build');
  const { Client: ClientCtor } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = buildServer(auth);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new ClientCtor({ name: 'caps-test', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as {
    structuredContent?: Record<string, unknown>;
    content?: { type: string; text: string }[];
  };
}

/** Simulates a redeploy/second replica: fresh module graph, same database. */
async function redeploy(db: Db, calls: string[]): Promise<void> {
  vi.resetModules();
  const g = await graph();
  g.dbMod._setDb(db);
  mockMinimax(calls, g.minimax._setFetch);
}

describe('anonymous MCP daily caps (usage_counters-backed)', () => {
  let db: Db;

  beforeEach(async () => {
    // start every test from a clean graph so a previous test's resetModules
    // cannot strand this test's db in a stale registry
    vi.resetModules();
    const g = await graph();
    g.pool._resetPoolCache();
    g.pool._setPoolDayForTests(null);
    db = g.dbMod.openDb(':memory:');
    g.dbMod._setDb(db);
    process.env.MINIMAX_API_KEY = 'test-key';
  });

  it('ask cap persists across module re-instantiation (same db)', async () => {
    const calls: string[] = [];
    const g = await graph();
    mockMinimax(calls, g.minimax._setFetch);

    const client = await wire(ANON);
    const first = await call(client, 'ask_radar', { question: 'What should I build next?' });
    expect(first.structuredContent).toMatchObject({ ok: true });
    expect(g.counters.peek(ANON.rateKey, 'ask', 'day')).toBe(1);

    await redeploy(db, calls);
    const g2 = await graph();
    const client2 = await wire(ANON);
    const second = await call(client2, 'ask_radar', { question: 'What should I build next?' });
    expect(second.structuredContent).toMatchObject({ ok: false });
    expect(String(second.structuredContent!.error)).toContain('daily ask cap reached (1)');
    expect(g2.counters.peek(ANON.rateKey, 'ask', 'day')).toBe(1);
    expect(calls.filter((c) => c === 'ask')).toHaveLength(1); // refused before any LLM spend
  });

  it('plan cap persists across module re-instantiation; cached plans stay available', async () => {
    const calls: string[] = [];
    const g = await graph();
    mockMinimax(calls, g.minimax._setFetch);
    const now = new Date();
    db.insert(g.schema.opportunities)
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
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .run();

    const client = await wire(ANON);
    const first = await call(client, 'generate_plan', { opportunity: 'bulk-bg-removal-api' });
    expect(first.structuredContent).toMatchObject({ ok: true, cached: false });
    expect(g.counters.peek(ANON.rateKey, 'plan', 'day')).toBe(1);

    await redeploy(db, calls);
    const client2 = await wire(ANON);
    const second = await call(client2, 'generate_plan', { opportunity: 'bulk-bg-removal-api' });
    expect(second.structuredContent).toMatchObject({ ok: false });
    expect(String(second.structuredContent!.error)).toContain('daily plan generation cap reached (1)');
    expect(calls.filter((c) => c === 'frame')).toHaveLength(1); // no second generation ran

    const cached = await call(client2, 'get_plan', { opportunity: 'bulk-bg-removal-api' });
    expect(cached.structuredContent).toMatchObject({ found: true });
  });

  it('gcCounters sweeps stale ask/plan keys and keeps the live window', async () => {
    const g = await graph();
    const now = new Date();
    const stale = new Date(now.getTime() - 3 * 864e5);
    g.counters.bump(ANON.rateKey, 'ask', 'day', stale);
    g.counters.bump(ANON.rateKey, 'plan', 'day', stale);
    g.counters.bump(ANON.rateKey, 'ask', 'day', now);

    const removed = g.counters.gcCounters(now);
    expect(removed).toBe(2);
    expect(g.counters.peek(ANON.rateKey, 'ask', 'day', now)).toBe(1);
    expect(g.counters.peek(ANON.rateKey, 'ask', 'day', stale)).toBe(0);
    expect(g.counters.peek(ANON.rateKey, 'plan', 'day', stale)).toBe(0);
    expect(db.select().from(g.schema.usageCounters).all()).toHaveLength(1);
  });
});
