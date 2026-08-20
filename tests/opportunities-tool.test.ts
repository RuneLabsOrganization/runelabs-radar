import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerOpportunityTools } from '../mcp/tools/opportunities';
import type { AuthContext } from '../mcp/lib/auth';
import { opportunities } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;

function authFor(rateKey: string): AuthContext {
  return { authed: true, userId: 1, scopes: new Set(['read', 'plans']), rateKey };
}

/** Minimal server wiring: only the opportunity tools, keyed by rateKey. */
async function wire(rateKey: string): Promise<Client> {
  const server = new McpServer({ name: 'opportunities-test', version: '0.0.1' });
  registerOpportunityTools(server, authFor(rateKey));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-test', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

// The SDK validates structuredContent against the tool's outputSchema on
// every call, so any payload/schema mismatch (e.g. missing exploring_count)
// throws here instead of silently passing.
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as {
    structuredContent?: Record<string, unknown>;
  };
}

interface SeedOpts {
  slug: string;
  sector?: string | null;
  flipScore: number;
  planRuns?: number;
  verdict?: 'pursue' | 'watch' | 'reject';
}

function seedOpp(o: SeedOpts): void {
  db.insert(opportunities)
    .values({
      slug: o.slug,
      title: `Opening ${o.slug}`,
      thesis: `Thesis for ${o.slug}: demand is real and the window is open.`,
      sector: o.sector ?? null,
      status: 'active',
      flipScore: o.flipScore,
      holdScore: 50,
      scores: JSON.stringify({ demand: 12, buildability: 11 }),
      kpis: null,
      evidence: '[]',
      verdict: o.verdict ?? 'pursue',
      confidence: 60,
      planRuns: o.planRuns ?? 0,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    .run();
}

function slugsOf(res: { structuredContent?: Record<string, unknown> }): string[] {
  return (res.structuredContent!.opportunities as { slug: string }[]).map((o) => o.slug);
}

describe('get_opportunities anti-homogeneity (9d/9e)', () => {
  beforeEach(() => {
    db = useTestDb();
  });

  it('caps sectors at 2 and reserves the last slot for an absent sector', async () => {
    seedOpp({ slug: 'a1', sector: 'devtools', flipScore: 90 });
    seedOpp({ slug: 'a2', sector: 'devtools', flipScore: 80 });
    seedOpp({ slug: 'a3', sector: 'devtools', flipScore: 70 });
    seedOpp({ slug: 'b1', sector: 'ai-coding', flipScore: 85 });
    seedOpp({ slug: 'b2', sector: 'ai-coding', flipScore: 75 });
    seedOpp({ slug: 'b3', sector: 'ai-coding', flipScore: 65 });
    seedOpp({ slug: 'c1', sector: 'ai-media', flipScore: 60 });
    seedOpp({ slug: 'c2', sector: 'ai-media', flipScore: 50 });
    const client = await wire('caller-1');
    const res = await call(client, 'get_opportunities', { limit: 5 });
    const opps = res.structuredContent!.opportunities as { slug: string; sector: string | null }[];
    expect(opps).toHaveLength(5);
    // quota: no sector appears more than twice
    const counts = new Map<string | null, number>();
    for (const o of opps) counts.set(o.sector, (counts.get(o.sector) ?? 0) + 1);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2);
    // all scores distinct → salt-independent: 4 quota picks in score order,
    // then the exploration pick from the absent third sector
    expect(slugsOf(res)).toEqual(['a1', 'b1', 'a2', 'b2', 'c1']);
    expect(opps[4]!.sector).toBe('ai-media');
    // a3 (70) and b3 (65) outscore the exploration item (60) but are
    // quota-dropped — the exploration slot is the deliberate exception
    expect(slugsOf(res)).not.toContain('a3');
    expect(slugsOf(res)).not.toContain('b3');
  });

  it('treats a null sector as its own quota bucket', async () => {
    seedOpp({ slug: 'n1', sector: null, flipScore: 90 });
    seedOpp({ slug: 'n2', sector: null, flipScore: 80 });
    seedOpp({ slug: 'n3', sector: null, flipScore: 70 });
    seedOpp({ slug: 'x1', sector: 'devtools', flipScore: 60 });
    const client = await wire('caller-1');
    const res = await call(client, 'get_opportunities', { limit: 4 });
    // n3 (70) is quota-dropped; the null bucket allows only n1 and n2
    expect(slugsOf(res)).toEqual(['n1', 'n2', 'x1']);
  });

  it('salts order per caller: stable for one rateKey, different across rateKeys', async () => {
    // equal scores → order fully determined by the per-caller salt hash
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6'];
    for (const [i, slug] of seeds.entries()) {
      seedOpp({ slug, sector: i < 3 ? 'alpha' : 'beta', flipScore: 70 });
    }
    const orders = new Set<string>();
    for (const key of ['alice', 'bob', 'carol', 'dave']) {
      const client = await wire(key);
      const res = await call(client, 'get_opportunities', { limit: 6 });
      orders.add(JSON.stringify(slugsOf(res)));
    }
    expect(orders.size).toBeGreaterThan(1);

    // same caller: identical order on repeat calls and on a fresh server
    const client = await wire('alice');
    const first = slugsOf(await call(client, 'get_opportunities', { limit: 6 }));
    expect(slugsOf(await call(client, 'get_opportunities', { limit: 6 }))).toEqual(first);
    const fresh = await wire('alice');
    expect(slugsOf(await call(fresh, 'get_opportunities', { limit: 6 }))).toEqual(first);
  });

  it('orders crowded items below their true score but reports the true score', async () => {
    seedOpp({ slug: 'crowded', sector: 'devtools', flipScore: 90, planRuns: 5 });
    seedOpp({ slug: 'at-threshold', sector: 'ai-media', flipScore: 90, planRuns: 3 });
    seedOpp({ slug: 'under-threshold', sector: 'ai-coding', flipScore: 90, planRuns: 2 });
    seedOpp({ slug: 'fresh', sector: 'saas-tools', flipScore: 85, planRuns: 0 });
    const client = await wire('caller-1');
    const res = await call(client, 'get_opportunities', { limit: 5 });
    // effective scores: under-threshold 90, at-threshold 80, crowded 80, fresh 85
    // → fresh (85) beats both penalized 90s; the unpenalized 90 leads
    expect(slugsOf(res)[0]).toBe('under-threshold');
    const order = slugsOf(res);
    expect(order.indexOf('fresh')).toBeLessThan(order.indexOf('crowded'));
    expect(order.indexOf('fresh')).toBeLessThan(order.indexOf('at-threshold'));
    // payload still reports the true flip_score and the raw planRuns
    const opps = res.structuredContent!.opportunities as { slug: string; flip_score: number; exploring_count: number }[];
    expect(opps.find((o) => o.slug === 'crowded')).toMatchObject({ flip_score: 90, exploring_count: 5 });
    expect(opps.find((o) => o.slug === 'fresh')).toMatchObject({ flip_score: 85, exploring_count: 0 });
  });

  it('exposes exploring_count in both get_opportunities and get_opportunity', async () => {
    seedOpp({ slug: 'tracked', sector: 'devtools', flipScore: 77, planRuns: 4 });
    const client = await wire('caller-1');

    const list = await call(client, 'get_opportunities', { limit: 5 });
    const row = (list.structuredContent!.opportunities as { slug: string; exploring_count: number }[])[0]!;
    expect(row.slug).toBe('tracked');
    expect(row.exploring_count).toBe(4);

    const one = await call(client, 'get_opportunity', { opportunity: 'tracked' });
    expect(one.structuredContent).toMatchObject({ found: true });
    expect((one.structuredContent!.opportunity as { exploring_count: number }).exploring_count).toBe(4);
  });

  it('keeps verdict / sector / min_flip filters working', async () => {
    seedOpp({ slug: 'p1', sector: 'devtools', flipScore: 90, verdict: 'pursue' });
    seedOpp({ slug: 'w1', sector: 'devtools', flipScore: 80, verdict: 'watch' });
    seedOpp({ slug: 'p2', sector: 'ai-coding', flipScore: 70, verdict: 'pursue' });
    const client = await wire('caller-1');

    const byVerdict = await call(client, 'get_opportunities', { verdict: 'watch', limit: 10 });
    expect(slugsOf(byVerdict)).toEqual(['w1']);

    const bySector = await call(client, 'get_opportunities', { sector: 'ai-coding', limit: 10 });
    expect(slugsOf(bySector)).toEqual(['p2']);

    const byMinFlip = await call(client, 'get_opportunities', { min_flip: 75, limit: 10 });
    expect(slugsOf(byMinFlip)).toEqual(['p1', 'w1']);
  });

  it('suggests the closest slugs on a get_opportunity miss', async () => {
    seedOpp({ slug: 'bulk-bg-removal-api', sector: 'ai-media', flipScore: 72 });
    const client = await wire('caller-1');

    const miss = await call(client, 'get_opportunity', { opportunity: 'bulk-bg' });
    expect(miss.structuredContent).toMatchObject({ found: false });
    expect(miss.structuredContent!.suggestions).toContain('bulk-bg-removal-api');

    const none = await call(client, 'get_opportunity', { opportunity: 'zzz-no-match' });
    expect(none.structuredContent).toMatchObject({ found: false, suggestions: [] });
  });
});
