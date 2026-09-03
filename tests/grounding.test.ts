import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerDebateTools } from '../mcp/tools/debate';
import { _setFetch } from '@/lib/llm/minimax';
import { runDebate } from '@/lib/opportunities/critic';
import { listVisibleDebateCards, loadVisibleDebate } from '@/lib/opportunities/debate-view';
import { comps, debates, launches, metricPoints, opportunities, painPoints } from '@/lib/db/schema';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

let db: Db;

const savedEnv = { key: process.env.MINIMAX_API_KEY, aaPublic: process.env.AA_PUBLIC };

beforeEach(() => {
  db = useTestDb();
  process.env.MINIMAX_API_KEY = 'test-key';
  delete process.env.AA_PUBLIC;
});

afterEach(() => {
  _setFetch(globalThis.fetch);
  if (savedEnv.key === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = savedEnv.key;
  if (savedEnv.aaPublic === undefined) delete process.env.AA_PUBLIC;
  else process.env.AA_PUBLIC = savedEnv.aaPublic;
});

const IDEA = 'A dashboard for devtools teams tracking LLM token spend across providers';

const ADVOCATE = { text: 'Token spend is a recurring pain and the tracker angle has clear demand evidence across the seeded sources.' };
const SKEPTIC = { text: 'Providers will ship their own dashboards and the incumbents already own the adjacent budgets.', killRisks: ['providers ship native dashboards'] };
const REALIST = { text: 'The comps and launch activity support a real niche, though the window is shorter than the advocate claims.' };
const JUDGE = {
  verdict: 'watch',
  confidence: 55,
  reasoning: 'Real opening with named platform risk; the economics close only at the low end of the stated pricing.',
  killRisks: ['providers ship native dashboards'],
  conditionsToSucceed: ['win one anchor devtools team'],
  strengthenedVariants: ['niche down to monorepo teams', 'usage-based pricing'],
};

/** Role-dispatched MiniMax mock that also captures every request body. */
function mockDebateLlm(): { bodies: { system: string; user: string }[] } {
  const bodies: { system: string; user: string }[] = [];
  _setFetch((async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { content: string }[] };
    const system = body.messages[0]!.content;
    bodies.push({ system, user: body.messages[1]!.content });
    let payload: unknown;
    if (system.includes('ADVOCATE')) payload = ADVOCATE;
    else if (system.includes('SKEPTIC')) payload = SKEPTIC;
    else if (system.includes('MARKET REALIST')) payload = REALIST;
    else if (system.includes('JUDGE')) payload = JUDGE;
    else throw new Error('unexpected LLM call in test');
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }),
    } as Response;
  }) as unknown as typeof fetch);
  return { bodies };
}

function seedGrounding(): void {
  const now = new Date();
  db.insert(painPoints)
    .values({
      summary: 'tracking LLM token spend for devtools teams is painful and manual',
      sector: 'devtools',
      intensity: 4,
      evidence: '[]',
      lastSeenAt: now,
      createdAt: now,
    })
    .run();
  db.insert(comps)
    .values({ kind: 'revenue', product: 'TokenSpendly', amountUsd: 240000, note: '$20k MRR', createdAt: now })
    .run();
  db.insert(launches)
    .values({ source: 'show-hn', title: 'Spendscope', url: 'https://example.com/spendscope', category: 'ai-coding', launchedAt: now, createdAt: now })
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
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .run();
}

/** First-party market series so marketModels() has prices to leak (or withhold). */
function seedMarket(): void {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  for (const row of [
    { source: 'open-bench', metric: 'intelligence', value: 50 },
    { source: 'provider-pricing', metric: 'price_in', value: 1 },
    { source: 'provider-pricing', metric: 'price_out', value: 4 },
  ]) {
    db.insert(metricPoints)
      .values({ source: row.source, entity: 'TestModel', metric: row.metric, value: row.value, date: today, createdAt: now })
      .run();
  }
}

async function wire(auth: AuthContext): Promise<Client> {
  const server = new McpServer({ name: 'grounding-test', version: '0.0.1' });
  registerDebateTools(server, auth);
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

const authedUser = (id: number): AuthContext => ({
  authed: true,
  userId: id,
  scopes: new Set(['read']),
  rateKey: `user:${id}`,
});

const anonymous = (rateKey: string): AuthContext => ({
  authed: false,
  userId: null,
  scopes: new Set(['read']),
  rateKey,
});

describe('debate grounding (MCP debate_idea → real runDebate)', () => {
  it('full grounding reaches the realist prompt; ideaText and card title stay the clean idea', async () => {
    seedUser(db, 1);
    seedGrounding();
    seedMarket();
    const { bodies } = mockDebateLlm();

    const client = await wire(authedUser(1));
    const res = await client.callTool({ name: 'debate_idea', arguments: { idea: IDEA } });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(true);
    expect(bodies).toHaveLength(4);

    // the realist (3rd role) sees the ENTIRE grounding block — sections that
    // the old 600-char ideaText slice destroyed (closest opportunities last)
    const realist = bodies[2]!.user;
    expect(realist).toContain('<grounding>');
    expect(realist).toContain('<pains>');
    expect(realist).toContain('tracking LLM token spend');
    expect(realist).toContain('<comps>');
    expect(realist).toContain('TokenSpendly');
    expect(realist).toContain('<launch-activity-7d>');
    expect(realist).toContain('<closest-opportunities>');
    expect(realist).toContain('llm-spend-tracker');

    // grounding is realist-only: advocate, skeptic and judge never see it
    expect(bodies[0]!.user).not.toContain('<grounding>');
    expect(bodies[1]!.user).not.toContain('<grounding>');
    expect(bodies[3]!.user).not.toContain('<grounding>');

    // an entitled (signed-in) caller gets the model-market prices, in BOTH the
    // tool-built grounding block and the realist's own grounding
    expect(realist).toContain('<model-market>');
    expect(realist).toContain('TestModel');

    // stored ideaText is the clean idea — no grounding markup — and so is the
    // public card title
    const row = db.select().from(debates).all()[0]!;
    expect(row.ideaText).toBe(IDEA);
    expect(row.ideaText).not.toContain('<grounding>');
    expect(loadVisibleDebate(row.id, 1)?.title).toBe(IDEA);
    const card = listVisibleDebateCards(1).find((c) => c.id === row.id);
    expect(card?.title).toBe(IDEA);
  });

  it('anonymous caller with AA_PUBLIC unset: prompt contains no market prices, grounding otherwise intact', async () => {
    seedGrounding();
    seedMarket();
    const { bodies } = mockDebateLlm();

    const client = await wire(anonymous('grounding-anon'));
    const res = await client.callTool({ name: 'debate_idea', arguments: { idea: IDEA } });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(true);

    const realist = bodies[2]!.user;
    expect(realist).not.toContain('TestModel');
    expect(realist).not.toContain('<model-market>');
    // the non-market grounding still arrives whole
    expect(realist).toContain('<pains>');
    expect(realist).toContain('TokenSpendly');
    expect(realist).toContain('llm-spend-tracker');
    // the payload's grounding list never claims market picks were used
    const grounding = (res.structuredContent as { grounding?: string[] }).grounding ?? [];
    expect(grounding.some((g) => g.includes('model-market'))).toBe(false);
  });

  it('anonymous caller with AA_PUBLIC=true: market prices are present', async () => {
    process.env.AA_PUBLIC = 'true';
    seedGrounding();
    seedMarket();
    const { bodies } = mockDebateLlm();

    const client = await wire(anonymous('grounding-public'));
    await client.callTool({ name: 'debate_idea', arguments: { idea: IDEA } });

    expect(bodies[2]!.user).toContain('<model-market>');
    expect(bodies[2]!.user).toContain('TestModel');
  });

  it('oversized grounding is truncated under its own budget, line-structure preserved', async () => {
    seedUser(db, 1);
    const { bodies } = mockDebateLlm();
    const bigBlock =
      '<grounding>\n' +
      Array.from({ length: 30 }, (_, i) => `- grounding line ${i} ${'x'.repeat(90)}`).join('\n') +
      '\n</grounding>';
    expect(bigBlock.length).toBeGreaterThan(2000);

    await runDebate(null, IDEA, 1, 'debate', { grounding: bigBlock, marketVisible: false });

    const realist = bodies[2]!.user;
    expect(realist).toContain('grounding line 0');
    expect(realist).not.toContain('grounding line 25'); // cut well before the end
    expect(realist).toContain('\n…');
    // the idea itself is untouched by the truncation
    expect(db.select().from(debates).all()[0]!.ideaText).toBe(IDEA);
  });
});
