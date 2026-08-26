import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerLeadTools } from '../mcp/tools/leads';
import { composeLeads } from '@/lib/opportunities/compose';
import { dismissLead, insertLeads } from '@/lib/opportunities/leads';
import { getStablePool } from '@/lib/opportunities/pool';
import { dayKey } from '@/lib/opportunities/seed';
import { seedWedges } from '@/lib/opportunities/wedges';
import { painPoints, stories } from '@/lib/db/schema';
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
  leads: {
    slug: string;
    title: string;
    heuristic_score: number;
    stage: string;
    evidence_refs: string[];
  }[];
  next_cursor: number | null;
  space_size: number;
  summary: string;
  next: { tool: string; arguments?: Record<string, unknown> }[];
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
    // Text-only MCP clients (Cursor) never see structuredContent — the summary
    // is the only way an agent learns the slug and pagination cursor.
    expect(p.summary).toContain(p.leads[0].slug);
    expect(p.summary).toContain(`next_cursor=${p.next_cursor}`);
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

  it('returns the page strongest-first and points refine_lead at that lead', async () => {
    const client = await wire(authFor(1, 'user:1'));
    const p = (await client.callTool({ name: 'get_leads', arguments: { limit: 8 } }))
      .structuredContent as unknown as LeadsPayload;
    expect(p.leads.length).toBeGreaterThan(1);
    const scores = p.leads.map((l) => l.heuristic_score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const refine = p.next.find((n) => n.tool === 'refine_lead');
    expect(refine).toBeDefined();
    expect(refine!.arguments?.lead).toBe(p.leads[0].slug);
  });

  it('serves anonymous callers too', async () => {
    const client = await wire(authFor(null, 'ip:1.2.3.4'));
    const p = (await client.callTool({ name: 'get_leads', arguments: { limit: 3 } }))
      .structuredContent as unknown as LeadsPayload;
    expect(p.count).toBe(3);
  });

  it('places every pain-derived lead before every story-derived lead even when the story scores higher', async () => {
    // Tagged stories so loadPrimitives admits them; high topScore so a story's
    // own heuristic can beat a weak pain after the intensity/wedge swing.
    for (const score of [15, 90, 40, 75, 20, 60, 55, 80]) {
      db.insert(stories)
        .values({
          title: `MCP agent code review tools scoring ${score}`,
          tldr: null,
          status: 'curated',
          topScore: score,
          createdAt: new Date(),
        })
        .run();
    }

    const client = await wire(authFor(1, 'user:1'));
    const p = (await client.callTool({ name: 'get_leads', arguments: { limit: 25 } }))
      .structuredContent as unknown as LeadsPayload;

    const isPain = (l: LeadsPayload['leads'][number]) =>
      l.evidence_refs.some((r) => r.startsWith('P'));
    const isStory = (l: LeadsPayload['leads'][number]) =>
      l.evidence_refs.some((r) => r.startsWith('S'));
    const pains = p.leads.filter(isPain);
    const storyLeads = p.leads.filter(isStory);
    expect(pains.length).toBeGreaterThan(0);
    expect(storyLeads.length).toBeGreaterThan(0);
    expect(Math.max(...storyLeads.map((l) => l.heuristic_score))).toBeGreaterThan(
      Math.min(...pains.map((l) => l.heuristic_score)),
    );

    const lastPainIdx = p.leads.reduce((last, l, i) => (isPain(l) ? i : last), -1);
    const firstStoryIdx = p.leads.findIndex(isStory);
    expect(lastPainIdx).toBeGreaterThanOrEqual(0);
    expect(firstStoryIdx).toBeGreaterThan(lastPainIdx);
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

  it('does not regenerate a dismissed lead on a later page at the same cursor', async () => {
    const client = await wire(authFor(1, 'user:1'));
    const first = (await client.callTool({ name: 'get_leads', arguments: { limit: 5 } }))
      .structuredContent as unknown as LeadsPayload;
    const dropped = first.leads[0]!.slug;
    const dismissed = await client.callTool({
      name: 'dismiss_opportunity',
      arguments: { target: dropped, reason: 'not for me' },
    });
    expect((dismissed.structuredContent as { ok: boolean }).ok).toBe(true);

    const again = (await client.callTool({ name: 'get_leads', arguments: { limit: 5, cursor: 0 } }))
      .structuredContent as unknown as LeadsPayload;
    expect(again.leads.map((l) => l.slug)).not.toContain(dropped);
  });

  it('carries the current sector filter into the pagination next-action', async () => {
    const client = await wire(authFor(1, 'user:1'));
    const p = (await client.callTool({
      name: 'get_leads',
      arguments: { limit: 3, sector: 'devtools' },
    })).structuredContent as unknown as LeadsPayload;
    const page = p.next.find((n) => n.tool === 'get_leads');
    expect(page).toBeDefined();
    expect(page!.arguments?.sector).toBe('devtools');
    expect(page!.arguments?.cursor).toBe(p.next_cursor);
    expect(p.summary).toContain('sector=devtools');
  });

  it('does not blame an empty wedge taxonomy when the sector filter matched nothing', async () => {
    const client = await wire(authFor(1, 'user:1'));
    const p = (await client.callTool({
      name: 'get_leads',
      arguments: { limit: 5, sector: 'no-such-sector' },
    })).structuredContent as unknown as LeadsPayload;
    expect(p.count).toBe(0);
    expect(p.summary).not.toMatch(/wedge taxonomy is empty/i);
    expect(p.summary).toMatch(/no-such-sector/);
  });

  it('holds the primitive pool for the rest of the day so a new pain cannot shift an issued cursor', async () => {
    const client = await wire(authFor(1, 'user:1'));
    const first = (await client.callTool({ name: 'get_leads', arguments: { limit: 8, cursor: 0 } }))
      .structuredContent as unknown as LeadsPayload;
    const blob = (leads: LeadsPayload['leads']) =>
      leads.map((l) => `${l.slug} ${l.title}`).join('\n');
    expect(blob(first.leads)).not.toMatch(/xyzzycachepain/i);

    db.insert(painPoints)
      .values({
        summary: 'XYZZYCACHEPAIN a unique new loud pain that would dominate composition',
        sector: 'devtools',
        intensity: 99,
        createdAt: new Date(),
        lastSeenAt: new Date(),
      })
      .run();

    const sameDay = (await client.callTool({ name: 'get_leads', arguments: { limit: 8, cursor: 0 } }))
      .structuredContent as unknown as LeadsPayload;
    expect(blob(sameDay.leads)).not.toMatch(/xyzzycachepain/i);

    const { _setPoolDayForTests } = await import('@/lib/opportunities/pool');
    _setPoolDayForTests('2099-01-01');
    const nextDay = (await client.callTool({ name: 'get_leads', arguments: { limit: 8, cursor: 0 } }))
      .structuredContent as unknown as LeadsPayload;
    expect(blob(nextDay.leads)).toMatch(/xyzzycachepain/i);
  });

  it('does not claim exhaustion when a scan window is empty but more space remains', async () => {
    const owner = { ownerKey: 'user:1', userId: 1 };
    const { primitives, space } = getStablePool();
    const scanned = composeLeads({
      primitives,
      space,
      ownerKey: owner.ownerKey,
      day: dayKey(),
      cursor: 0,
      limit: 4000,
    });
    expect(scanned.spaceSize).toBeGreaterThan(scanned.scanned);
    expect(scanned.nextCursor).not.toBeNull();
    insertLeads(owner, scanned.leads);
    for (const l of scanned.leads) dismissLead(owner, l.slug, 'skip');

    const client = await wire(authFor(1, 'user:1'));
    const p = (await client.callTool({
      name: 'get_leads',
      arguments: { limit: 5, cursor: 0, sector: 'devtools' },
    })).structuredContent as unknown as LeadsPayload;
    expect(p.count).toBe(0);
    expect(p.next_cursor).not.toBeNull();
    expect(p.space_size).toBeGreaterThan(4000);
    expect(p.summary).not.toMatch(/end of your combination space/i);
    expect(p.summary).toMatch(/scan window|unexplored/i);
    const more = p.next.find((n) => n.tool === 'get_leads');
    expect(more).toBeDefined();
    expect(more!.arguments?.cursor).toBe(p.next_cursor);
    expect(more!.arguments?.sector).toBe('devtools');
  });
});
