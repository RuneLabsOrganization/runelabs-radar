import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerLeadTools } from '../mcp/tools/leads';
import { seedWedges } from '@/lib/opportunities/wedges';
import { painPoints } from '@/lib/db/schema';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function authFor(userId: number | null, rateKey: string): AuthContext {
  return { authed: userId != null, userId, scopes: new Set(['read']), rateKey };
}

async function wire(auth: AuthContext): Promise<Client> {
  const server = new McpServer({ name: 'leads-test', version: '0.0.1' });
  registerLeadTools(server, auth);
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

interface LeadsPayload {
  count: number;
  leads: { slug: string; title: string; heuristic_score: number; stage: string }[];
  next_cursor: number | null;
  space_size: number;
  summary: string;
  next: { tool: string }[];
}

function seedPains(db: Db, n: number) {
  const now = new Date();
  const topics = [
    'Bulk product photo editing is manual for storefront sellers',
    'Agents cannot call internal tools without bespoke glue code',
    'SOC2 evidence collection eats a week each quarter for ops teams',
    'Code review backlogs block small engineering teams every sprint',
    'Video render pipelines cost more than the creative work itself',
  ];
  for (let i = 0; i < n; i++) {
    db.insert(painPoints)
      .values({
        summary: `${topics[i % topics.length]} (variant ${i})`,
        sector: 'devtools',
        intensity: 10 - (i % 5),
        createdAt: now,
        lastSeenAt: now,
      })
      .run();
  }
}

describe('get_leads', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    seedUser(db, 1);
    seedUser(db, 2);
    seedWedges();
    seedPains(db, 6);
  });

  it('returns composed leads with no verdict or flip score', async () => {
    const client = await wire(authFor(1, 'user:1'));
    const res = await client.callTool({ name: 'get_leads', arguments: { limit: 5 } });
    const p = res.structuredContent as unknown as LeadsPayload;
    expect(p.count).toBe(5);
    expect(p.leads[0].stage).toBe('composed');
    expect(p.leads[0]).not.toHaveProperty('verdict');
    expect(p.leads[0]).not.toHaveProperty('flip_score');
    expect(p.space_size).toBeGreaterThan(1000);
  });

  it('gives two callers different leads', async () => {
    const a = (await (await wire(authFor(1, 'user:1')))
      .callTool({ name: 'get_leads', arguments: { limit: 8 } }))
      .structuredContent as unknown as LeadsPayload;
    const b = (await (await wire(authFor(2, 'user:2')))
      .callTool({ name: 'get_leads', arguments: { limit: 8 } }))
      .structuredContent as unknown as LeadsPayload;
    const overlap = a.leads.map((l) => l.slug).filter((s) => b.leads.some((l) => l.slug === s));
    expect(overlap.length).toBeLessThanOrEqual(2);
  });

  it('pages without repeating', async () => {
    const client = await wire(authFor(1, 'user:1'));
    const first = (await client.callTool({ name: 'get_leads', arguments: { limit: 5 } }))
      .structuredContent as unknown as LeadsPayload;
    expect(first.next_cursor).not.toBeNull();
    const second = (await client.callTool({
      name: 'get_leads',
      arguments: { limit: 5, cursor: first.next_cursor },
    })).structuredContent as unknown as LeadsPayload;
    const overlap = second.leads.map((l) => l.slug)
      .filter((s) => first.leads.some((l) => l.slug === s));
    expect(overlap).toEqual([]);
  });

  it('serves anonymous callers too', async () => {
    const client = await wire(authFor(null, 'ip:1.2.3.4'));
    const p = (await client.callTool({ name: 'get_leads', arguments: { limit: 3 } }))
      .structuredContent as unknown as LeadsPayload;
    expect(p.count).toBe(3);
  });

  it('explains itself when the stream is too thin', async () => {
    const fresh = useTestDb();
    seedUser(fresh, 1);
    seedWedges();
    const client = await wire(authFor(1, 'user:1'));
    const p = (await client.callTool({ name: 'get_leads', arguments: { limit: 5 } }))
      .structuredContent as unknown as LeadsPayload;
    expect(p.count).toBe(0);
    expect(p.summary).toMatch(/no demand signal in the last 21 days/i);
    expect(p.next.length).toBeGreaterThan(0);
  });
});
