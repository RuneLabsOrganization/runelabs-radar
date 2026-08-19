import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../mcp/build';
import type { AuthContext } from '../mcp/lib/auth';
import { _setFetch } from '@/lib/llm/minimax';
import { opportunities, stories } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';

const AUTH: AuthContext = {
  authed: false,
  userId: null,
  scopes: new Set(['read', 'plans']),
  rateKey: 'test',
};

let db: ReturnType<typeof useTestDb>;

async function wire(): Promise<Client> {
  const server = buildServer(AUTH);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-test', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    structuredContent?: Record<string, unknown>;
    content?: { type: string; text: string }[];
  };
  return result;
}

// --- mocked MiniMax for the plan-generation test ---

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

function mockMinimax(): { calls: string[] } {
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
      payload = phaseJson(m[1]!);
      calls.push(`phase:${m[1]}`);
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: {} }),
    } as Response;
  }) as unknown as typeof fetch);
  return { calls };
}

function seedOpportunity(): void {
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
    })
    .run();
}

describe('mcp server', () => {
  beforeEach(() => {
    db = useTestDb();
    // chatJSON refuses to call out without a key; the fetch below is mocked anyway
    process.env.MINIMAX_API_KEY = 'test-key';
  });

  it('registers the full tool surface', async () => {
    const client = await wire();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'generate_plan',
        'get_accuracy',
        'get_best_right_now',
        'get_board_changes',
        'get_comps',
        'get_daily_brief',
        'get_daily_insights',
        'get_domain_digest',
        'get_entity',
        'get_forecasts',
        'get_launches',
        'get_market_models',
        'get_metric_series',
        'get_opportunities',
        'get_opportunity',
        'get_pain_points',
        'get_patterns',
        'get_plan',
        'get_server_guide',
        'get_stack_for',
        'get_story',
        'get_top_signals',
        'get_topic_map',
        'list_metrics',
        'list_stacks',
        'search_stories',
      ].sort(),
    );
  });

  it('serves the read tools against an empty database', async () => {
    const client = await wire();
    const opps = await call(client, 'get_opportunities', { limit: 3 });
    expect(opps.structuredContent).toMatchObject({ count: 0, opportunities: [] });

    const board = await call(client, 'get_best_right_now', {});
    expect(board.structuredContent).toMatchObject({ count: 0 });

    const series = await call(client, 'get_metric_series', { source: 'aa', entity: 'x', metric: 'y' });
    expect(series.structuredContent).toMatchObject({ found: false, points: [] });

    const brief = await call(client, 'get_daily_brief', {});
    expect(brief.content?.[0]?.text).toContain('No brief found');
    expect(brief.content?.[0]?.text).toContain('Source:');
  });

  it('search_stories finds a freshly seeded story (regression: seconds-vs-ms cutoff)', async () => {
    db.insert(stories)
      .values({
        title: 'TestFlight Explorer Pro launches',
        tldr: 'A synthetic test story about testflight explorers.',
        status: 'curated',
        topScore: 80,
        createdAt: new Date(),
      })
      .run();
    const client = await wire();
    const res = await call(client, 'search_stories', { query: 'testflight', limit: 5 });
    expect(res.structuredContent).toMatchObject({ count: 1 });
    const hit = (res.structuredContent!.results as { title: string; created_at: string }[])[0]!;
    expect(hit.title).toContain('TestFlight');
    expect(hit.created_at.startsWith('20')).toBe(true); // not a 1970 date
  });

  it('gates model-market data for anonymous access when AA_PUBLIC is off', async () => {
    const client = await wire();
    const market = await call(client, 'get_market_models', {});
    expect(market.structuredContent).toMatchObject({ restricted: true });
  });

  it('serves resources and prompts', async () => {
    const client = await wire();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('radar://brief/latest');
    expect(resources.map((r) => r.uri)).toContain('radar://opportunities');

    const read = await client.readResource({ uri: 'radar://opportunities' });
    const parsed = JSON.parse((read.contents[0] as { text: string }).text);
    expect(parsed).toMatchObject({ count: 0 });

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'builder_weekly_review',
      'find_and_plan',
      'validate_idea',
      'what_should_i_use',
      'whats_new_today',
    ]);

    const prompt = await client.getPrompt({ name: 'find_and_plan', arguments: {} });
    expect(prompt.messages[0]!.content.type).toBe('text');
    expect((prompt.messages[0]!.content as { text: string }).text).toContain('generate_plan');
  });

  it('runs the flagship: get_plan miss → generate_plan → cached plan + markdown', async () => {
    seedOpportunity();
    const { calls } = mockMinimax();
    const client = await wire();

    const miss = await call(client, 'get_plan', { opportunity: 'bulk-bg-removal-api' });
    expect(miss.structuredContent).toMatchObject({ found: false });

    const progress: { progress: number; total?: number; message?: string }[] = [];
    const gen = (await client.callTool(
      { name: 'generate_plan', arguments: { opportunity: 'bulk-bg-removal-api' } },
      undefined,
      { onprogress: (p) => progress.push({ progress: p.progress, total: p.total, message: p.message }) },
    )) as { structuredContent?: Record<string, unknown> };
    expect(gen.structuredContent).toMatchObject({ ok: true, cached: false });
    // 7 progress events: brief, frame, 5 phases
    expect(progress.map((p) => p.message)).toEqual([
      'launch brief',
      'plan frame',
      'phase: validation',
      'phase: build',
      'phase: launch',
      'phase: gtm',
      'phase: revenue',
    ]);
    expect(progress.at(-1)).toMatchObject({ progress: 7, total: 7 });
    const plan = gen.structuredContent!.plan as {
      phases: { phase: string; tasks: unknown[] }[];
      opportunity: string;
    };
    expect(plan.opportunity).toBe('bulk-bg-removal-api');
    expect(plan.phases.map((p) => p.phase)).toEqual(['validation', 'build', 'launch', 'gtm', 'revenue']);
    expect(gen.structuredContent!.markdown).toContain('# Bulk background-removal API');
    expect(calls.sort()).toEqual(
      ['brief', 'frame', 'phase:build', 'phase:gtm', 'phase:launch', 'phase:revenue', 'phase:validation'].sort(),
    );

    // second call: served from cache, zero LLM calls
    const again = await call(client, 'generate_plan', { opportunity: 'bulk-bg-removal-api' });
    expect(again.structuredContent).toMatchObject({ ok: true, cached: true });
    expect(calls).toHaveLength(7);

    // the radar://plan resource sees the cached plan too
    const res = await client.readResource({ uri: 'radar://plan/bulk-bg-removal-api' });
    const parsed = JSON.parse((res.contents[0] as { text: string }).text);
    expect(parsed.found).toBe(true);
    expect(parsed.plan.phases).toHaveLength(5);

    const md = await call(client, 'get_plan', { opportunity: 'bulk-bg-removal-api', format: 'markdown' });
    expect(md.structuredContent).toMatchObject({ found: true });
    expect(md.structuredContent!.markdown).toContain('Phase 1 — Validation');
  });
});
