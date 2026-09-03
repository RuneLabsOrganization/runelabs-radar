import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { _setFetch } from '@/lib/llm/minimax';
import { opportunities } from '@/lib/db/schema';
import { generateBrief } from '@/lib/opportunities/brief';
import { useTestDb } from './helpers/db';

const CACHED_BRIEF = {
  icp: 'E-commerce operators with large catalogs who pay per-image editors',
  mvp: ['upload API', 'background removal worker', 'credit billing'],
  stackVenture: 'ai-product',
  stackNotes: null,
  unitEconomics: {
    assumptions: ['gpt-image-1 at $0.04/image'],
    monthlyCostUsd: 40,
    suggestedPriceUsd: 29,
    breakEvenCustomers: 2,
  },
  gtm: ['shopify app store'],
  risks: ['platform dependency'],
};

const FRESH_BRIEF = {
  ...CACHED_BRIEF,
  icp: 'Fresh restricted brief grounded without any market prices',
};

const USAGE = { prompt_tokens: 10, completion_tokens: 5 };

function llmOk(payload: unknown): Response {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: USAGE }),
  } as Response;
}

function seedOpportunity(withBrief: unknown): number {
  const db = getDb();
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
      ...(withBrief ? { brief: JSON.stringify(withBrief), briefGeneratedAt: new Date() } : {}),
    })
    .run();
  return db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(eq(opportunities.slug, 'bulk-bg-removal-api'))
    .get()!.id;
}

describe('generateBrief market-visibility cache classes', () => {
  beforeEach(() => {
    useTestDb();
    vi.stubEnv('MINIMAX_API_KEY', 'test-key');
  });

  afterEach(() => {
    _setFetch(globalThis.fetch);
    vi.unstubAllEnvs();
  });

  it('serves the on-row cache to market-allowed callers without an LLM call', async () => {
    const oppId = seedOpportunity(CACHED_BRIEF);
    let calls = 0;
    _setFetch((async () => {
      calls++;
      return llmOk(FRESH_BRIEF);
    }) as unknown as typeof fetch);

    const res = await generateBrief(oppId, { allowMarket: true });

    expect(res.ok).toBe(true);
    expect(res.ok && res.brief.icp).toBe(CACHED_BRIEF.icp);
    expect(calls).toBe(0);
  });

  it('regenerates for market-restricted callers without leaking or overwriting the market-priced cache', async () => {
    const oppId = seedOpportunity(CACHED_BRIEF);
    const seenUsers: string[] = [];
    _setFetch((async (_url: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body) as { messages: { content: string }[] };
      seenUsers.push(body.messages[1]!.content);
      return llmOk(FRESH_BRIEF);
    }) as unknown as typeof fetch);

    const res = await generateBrief(oppId, { allowMarket: false });

    // a fresh market-free brief — not the cached market-priced one
    expect(res.ok).toBe(true);
    expect(res.ok && res.brief.icp).toBe(FRESH_BRIEF.icp);
    expect(seenUsers).toHaveLength(1);
    expect(seenUsers[0]).toContain('(market data withheld for this caller)');
    // the shared on-row cache is untouched
    const row = getDb()
      .select({ brief: opportunities.brief })
      .from(opportunities)
      .where(eq(opportunities.id, oppId))
      .get()!;
    expect(row.brief).toBe(JSON.stringify(CACHED_BRIEF));

    // and the entitled caller still gets the cached brief, no second LLM call
    const entitled = await generateBrief(oppId, { allowMarket: true });
    expect(entitled.ok).toBe(true);
    expect(entitled.ok && entitled.brief.icp).toBe(CACHED_BRIEF.icp);
    expect(seenUsers).toHaveLength(1);
  });

  it('does not persist a market-free brief over an empty cache slot', async () => {
    const oppId = seedOpportunity(null);
    _setFetch((async () => llmOk(FRESH_BRIEF)) as unknown as typeof fetch);

    const res = await generateBrief(oppId, { allowMarket: false });

    expect(res.ok).toBe(true);
    const row = getDb()
      .select({ brief: opportunities.brief })
      .from(opportunities)
      .where(eq(opportunities.id, oppId))
      .get()!;
    expect(row.brief).toBeNull();
  });
});
