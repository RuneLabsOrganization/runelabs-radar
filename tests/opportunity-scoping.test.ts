import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerOpportunityTools } from '../mcp/tools/opportunities';
import { opportunities } from '@/lib/db/schema';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function seedOpp(db: Db, slug: string, ownerUserId: number | null, flip = 60, sector = 'devtools') {
  const now = new Date();
  db.insert(opportunities)
    .values({
      slug,
      ownerUserId,
      title: `Title for ${slug}`,
      thesis: 'A sufficiently long thesis to satisfy any downstream validation rules.',
      sector,
      status: 'active',
      flipScore: flip,
      holdScore: 40,
      scores: '{}',
      evidence: '[]',
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .run();
}

function authFor(userId: number | null): AuthContext {
  return {
    authed: userId != null,
    userId,
    scopes: new Set(['read', 'plans']),
    rateKey: userId != null ? `user:${userId}` : 'ip:test',
  };
}

async function wire(userId: number | null): Promise<Client> {
  const server = new McpServer({ name: 'opp-scope-test', version: '0.0.1' });
  registerOpportunityTools(server, authFor(userId));
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

async function listSlugs(client: Client, args: Record<string, unknown> = {}): Promise<string[]> {
  const res = await client.callTool({ name: 'get_opportunities', arguments: { limit: 25, ...args } });
  const structured = res.structuredContent as { opportunities: { slug: string }[] };
  return structured.opportunities.map((o) => o.slug);
}

describe('opportunity read scoping', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    // MCP tools record economy against mcp_economy, which FKs to users.id
    seedUser(db, 1);
    seedUser(db, 2);
    seedOpp(db, 'public-one', null, 90);
    seedOpp(db, 'public-two', null, 80);
    seedOpp(db, 'alice-private', 1, 95);
    seedOpp(db, 'bob-private', 2, 95);
  });

  it('shows a user the public radar plus only their own private openings', async () => {
    const slugs = await listSlugs(await wire(1));
    expect(slugs).toContain('public-one');
    expect(slugs).toContain('alice-private');
    expect(slugs).not.toContain('bob-private');
  });

  it('shows anonymous callers only the public radar', async () => {
    const slugs = await listSlugs(await wire(null));
    expect(slugs).toEqual(expect.arrayContaining(['public-one', 'public-two']));
    expect(slugs).not.toContain('alice-private');
    expect(slugs).not.toContain('bob-private');
  });

  it('refuses to fetch another owner private dossier by slug', async () => {
    const client = await wire(1);
    const res = await client.callTool({
      name: 'get_opportunity',
      arguments: { opportunity: 'bob-private' },
    });
    expect((res.structuredContent as { found: boolean }).found).toBe(false);
  });

  it('returns a cursor when more results exist and advances past them', async () => {
    // Ranked prefix needs a 3rd-sector row so the quota walk can fill
    // limit=3 (2×devtools + exploration) without pulling a later filler.
    seedOpp(db, 'other-sector', null, 85, 'ai-media');
    for (let i = 0; i < 10; i++) seedOpp(db, `filler-${i}`, null, 50 - i);
    const client = await wire(1);
    const first = await client.callTool({ name: 'get_opportunities', arguments: { limit: 3 } });
    const page1 = first.structuredContent as { opportunities: { slug: string }[]; next_cursor: number | null };
    expect(page1.opportunities).toHaveLength(3);
    expect(page1.next_cursor).toBe(3);

    const second = await client.callTool({
      name: 'get_opportunities',
      arguments: { limit: 3, cursor: page1.next_cursor },
    });
    const page2 = second.structuredContent as { opportunities: { slug: string }[] };
    const overlap = page2.opportunities
      .map((o) => o.slug)
      .filter((s) => page1.opportunities.some((p) => p.slug === s));
    expect(overlap).toEqual([]);
  });
});
