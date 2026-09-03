import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerOpportunityTools } from '../mcp/tools/opportunities';
import { opportunities } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

/**
 * G2 regression: cursor pagination over the sector-quota walk used to skip
 * quota-overflow rows — rows consumed into `rest` while filling a page were
 * never revisited because next_cursor resumed past their index. The cursor is
 * now an offset into the fully-paginated order, so paging to the end returns
 * every ranked row exactly once.
 */

const AUTH: AuthContext = { authed: false, userId: null, scopes: new Set(['read']), rateKey: 'pagination-test' };

let db: Db;

async function wire(): Promise<Client> {
  const server = new McpServer({ name: 'pagination-test', version: '0.0.1' });
  registerOpportunityTools(server, AUTH);
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

function seedOpp(slug: string, sector: string, flipScore: number): void {
  db.insert(opportunities)
    .values({
      slug,
      title: `Opening ${slug}`,
      thesis: `Thesis for ${slug}: demand is real and the window is open.`,
      sector,
      status: 'active',
      flipScore,
      holdScore: 50,
      scores: '{}',
      evidence: '[]',
      verdict: 'watch',
      confidence: 50,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    .run();
}

interface Page {
  count: number;
  next_cursor: number | null;
  opportunities: { slug: string; sector: string | null }[];
}

async function page(client: Client, limit: number, cursor: number | null): Promise<Page> {
  const res = (await client.callTool({
    name: 'get_opportunities',
    arguments: { limit, ...(cursor !== null ? { cursor } : {}) },
  })) as { structuredContent?: unknown };
  return res.structuredContent as Page;
}

beforeEach(() => {
  db = useTestDb();
  // 6 rows in one sector (heavy overflow: quota is 2/page), 2 + 2 in others.
  // Distinct flip scores → ranked order is fully deterministic (salt only
  // breaks ties), so page contents below are exact, not statistical.
  const seeds: [string, string, number][] = [
    ['d1', 'devtools', 100],
    ['d2', 'devtools', 95],
    ['d3', 'devtools', 90],
    ['d4', 'devtools', 85],
    ['d5', 'devtools', 80],
    ['d6', 'devtools', 75],
    ['c1', 'ai-coding', 70],
    ['c2', 'ai-coding', 65],
    ['m1', 'ai-media', 60],
    ['m2', 'ai-media', 55],
  ];
  for (const [slug, sector, flip] of seeds) seedOpp(slug, sector, flip);
});

describe('get_opportunities cursor pagination over sector overflow', () => {
  it('pages through the whole ranked window with no skips and no duplicates', async () => {
    const client = await wire();
    const seen: string[] = [];
    let cursor: number | null = null;
    for (let pages = 0; pages < 10 && (pages === 0 || cursor !== null); pages++) {
      const p = await page(client, 3, cursor);
      expect(p.count).toBeLessThanOrEqual(3);
      // the quota still holds within every page: at most 2 per sector
      const perSector = new Map<string | null, number>();
      for (const o of p.opportunities) perSector.set(o.sector, (perSector.get(o.sector) ?? 0) + 1);
      for (const n of perSector.values()) expect(n).toBeLessThanOrEqual(2);
      seen.push(...p.opportunities.map((o) => o.slug));
      cursor = p.next_cursor;
    }
    expect(cursor).toBeNull(); // the walk terminated
    // union of pages == the full ranked window, each row exactly once
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual(['c1', 'c2', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'm1', 'm2'].sort());
    // the regression pinpoint: overflow rows d3-d6 were previously skipped
    expect(seen).toContain('d3');
    expect(seen).toContain('d6');
  });

  it('keeps the first page identical to the pre-fix quota walk', async () => {
    const client = await wire();
    const first = await page(client, 3, null);
    // 2 devtools quota picks, then the exploration slot from an absent sector
    expect(first.opportunities.map((o) => o.slug)).toEqual(['d1', 'd2', 'c1']);
    expect(first.next_cursor).toBe(3);
    // and the next page resumes with the deferred overflow rows, not past them
    const second = await page(client, 3, first.next_cursor);
    expect(second.opportunities.map((o) => o.slug)).toEqual(['d3', 'd4', 'c2']);
  });

  it('is stable for one caller: same cursor returns the same page twice', async () => {
    const client = await wire();
    const a = await page(client, 3, null);
    const fresh = await wire();
    const b = await page(fresh, 3, null);
    expect(b.opportunities.map((o) => o.slug)).toEqual(a.opportunities.map((o) => o.slug));
  });

  it('returns an empty page and null cursor past the end', async () => {
    const client = await wire();
    const p = await page(client, 3, 10);
    expect(p).toMatchObject({ count: 0, next_cursor: null, opportunities: [] });
  });
});
