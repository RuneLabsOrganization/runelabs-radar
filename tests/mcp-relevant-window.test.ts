import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerJobTools } from '../mcp/tools/jobs';
import { opportunities } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

/**
 * G1 regression: whats_relevant used to load EVERY visible active opportunity
 * into memory for token-overlap matching. The scan is now bounded to the top
 * RANK_WINDOW (200) by flip score, like get_opportunities — a matching row
 * outside the window must not be returned (and is never read).
 */

const AUTH: AuthContext = { authed: false, userId: null, scopes: new Set(['read']), rateKey: 'relevant-test' };

let db: Db;

async function wire(): Promise<Client> {
  const server = new McpServer({ name: 'relevant-test', version: '0.0.1' });
  registerJobTools(server, AUTH);
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

function seedOpp(slug: string, title: string, flipScore: number): void {
  db.insert(opportunities)
    .values({
      slug,
      title,
      thesis: `Thesis for ${title}.`,
      sector: 'devtools',
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

beforeEach(() => {
  db = useTestDb();
  // 200 high-flip rows with zero token overlap against the project…
  for (let i = 0; i < 200; i++) {
    seedOpp(`plain-${i}`, `Ordinary alpha beta opening ${i}`, 90);
  }
  // …then 50 low-flip rows that match the project perfectly. A bounded scan
  // (top 200 by flip) never sees them; the old unbounded scan returned them.
  for (let i = 0; i < 50; i++) {
    seedOpp(`low-${i}`, `zqxwv jklmkn matcher ${i}`, 10);
  }
  // positive control: one in-window row that matches the project
  seedOpp('zqxwv-high', 'zqxwv jklmkn high opening', 95);
});

describe('whats_relevant bounded opportunity scan', () => {
  it('matches only within the top flip-ranked window, not the whole table', async () => {
    const client = await wire();
    const res = (await client.callTool({
      name: 'whats_relevant',
      arguments: { project: 'zqxwv jklmkn pipeline' },
    })) as { structuredContent?: { opportunities: { slug: string }[] } };
    const slugs = res.structuredContent!.opportunities.map((o) => o.slug);
    expect(slugs).toEqual(['zqxwv-high']);
  });
});
