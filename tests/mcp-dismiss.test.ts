import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerLeadTools } from '../mcp/tools/leads';
import { registerOpportunityTools } from '../mcp/tools/opportunities';
import { insertLeads, listLeads } from '@/lib/opportunities/leads';
import type { LeadDraft } from '@/lib/opportunities/compose';
import { getProfile, setProfile } from '@/lib/personalization';
import { opportunities, planEntitlements } from '@/lib/db/schema';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function draft(slug: string, sector: string): LeadDraft {
  return {
    slug, title: `Title for ${slug}`, thesisSkeleton: 'A composed skeleton.',
    sector, primitiveRefs: ['P1'], primitiveType: 'pain',
    evidenceSnapshot: [],
    wedge: {
      business_model: 'subscription-saas', delivery_form: 'cli-tool',
      buyer: 'solo-builder', moat_play: 'workflow-lock-in',
    },
    heuristicScore: 60, combinationIndex: 7,
  };
}

function authFor(userId: number | null): AuthContext {
  return {
    authed: userId != null, userId, scopes: new Set(['read']),
    rateKey: userId != null ? `user:${userId}` : 'ip:test',
  };
}

async function wire(userId: number | null): Promise<Client> {
  const server = new McpServer({ name: 'dismiss-test', version: '0.0.1' });
  const auth = authFor(userId);
  registerLeadTools(server, auth);
  registerOpportunityTools(server, auth);
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

function seedOpp(db: Db, slug: string, ownerUserId: number | null, sector = 'devtools') {
  const now = new Date();
  db.insert(opportunities)
    .values({
      slug, ownerUserId, title: `Title for ${slug}`,
      thesis: 'A sufficiently long thesis for dismiss tests to archive against.',
      sector, status: 'active', flipScore: 70, holdScore: 50,
      scores: '{}', evidence: '[]', firstSeenAt: now, lastSeenAt: now,
    })
    .run();
}

const PUBLIC_REFUSE =
  "Public radar opportunities can't be dismissed — they're shared. Use avoid_sector on a lead instead, or filter sector on get_opportunities.";

describe('dismiss_opportunity', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    seedUser(db, 1);
    seedUser(db, 2);
    db.insert(planEntitlements)
      .values({ userId: 1, tier: 'builder', plansPerMonth: 30, resetDay: 1 })
      .run();
  });

  it('hides the lead from future listings', async () => {
    insertLeads({ ownerKey: 'user:1', userId: 1 }, [draft('nope', 'devtools')]);
    const res = await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'nope', reason: 'too capital heavy' },
    });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(true);
    expect(listLeads({ ownerKey: 'user:1', userId: 1 }, { limit: 10 }).leads).toHaveLength(0);
  });

  it('adds the sector to the avoid list when asked', async () => {
    setProfile(1, { interests: ['devtools'] });
    insertLeads({ ownerKey: 'user:1', userId: 1 }, [draft('wrong-sector', 'adtech')]);
    await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'wrong-sector', reason: 'not my market', avoid_sector: true },
    });
    expect(getProfile(1)?.avoidedSectors).toContain('adtech');
  });

  it('leaves the avoid list alone by default', async () => {
    insertLeads({ ownerKey: 'user:1', userId: 1 }, [draft('one-off', 'fintech')]);
    await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'one-off', reason: 'just this one' },
    });
    expect(getProfile(1)?.avoidedSectors ?? []).not.toContain('fintech');
  });

  it('reports an unknown target honestly', async () => {
    const res = await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'ghost', reason: 'n/a' },
    });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(false);
  });

  it('archives an owned private opportunity so get_opportunities drops it', async () => {
    seedOpp(db, 'mine-to-drop', 1);
    const res = await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'mine-to-drop', reason: 'not for me' },
    });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(true);
    const row = db.select().from(opportunities).where(eq(opportunities.slug, 'mine-to-drop')).get();
    expect(row?.status).toBe('archived');
    expect(row?.ownerUserId).toBe(1);

    const listed = await (await wire(1)).callTool({
      name: 'get_opportunities',
      arguments: { limit: 25 },
    });
    const slugs = (listed.structuredContent as { opportunities: { slug: string }[] })
      .opportunities.map((o) => o.slug);
    expect(slugs).not.toContain('mine-to-drop');
  });

  it('refuses a public radar slug without touching the row', async () => {
    seedOpp(db, 'public-radar', null);
    const res = await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'public-radar', reason: 'not for me' },
    });
    const p = res.structuredContent as { ok: boolean; error: string };
    expect(p.ok).toBe(false);
    expect(p.error).toBe(PUBLIC_REFUSE);
    const row = db.select().from(opportunities).where(eq(opportunities.slug, 'public-radar')).get();
    expect(row?.status).toBe('active');
    expect(row?.ownerUserId).toBeNull();
  });

  it('returns the same error for another owner\'s private slug as for a missing slug', async () => {
    const missing = await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'hidden-from-me', reason: 'n/a' },
    });
    const missingErr = (missing.structuredContent as { error: string }).error;

    seedOpp(db, 'hidden-from-me', 2);
    const others = await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'hidden-from-me', reason: 'n/a' },
    });
    const othersErr = (others.structuredContent as { error: string }).error;

    expect(othersErr).toBe(missingErr);
    const row = db.select().from(opportunities).where(eq(opportunities.slug, 'hidden-from-me')).get();
    expect(row?.status).toBe('active');
    expect(row?.ownerUserId).toBe(2);
  });

  it('adds the opportunity sector to the avoid list when asked', async () => {
    setProfile(1, { interests: ['devtools'] });
    seedOpp(db, 'wrong-market', 1, 'adtech');
    await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'wrong-market', reason: 'not my market', avoid_sector: true },
    });
    expect(getProfile(1)?.avoidedSectors).toContain('adtech');
  });

  it('archives an owned opportunity even when a matching lead is also dismissed', async () => {
    insertLeads({ ownerKey: 'user:1', userId: 1 }, [draft('refined-mine', 'devtools')]);
    seedOpp(db, 'refined-mine', 1);
    const res = await (await wire(1)).callTool({
      name: 'dismiss_opportunity',
      arguments: { target: 'refined-mine', reason: 'passed' },
    });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(true);
    expect(listLeads({ ownerKey: 'user:1', userId: 1 }, { limit: 10 }).leads).toHaveLength(0);
    expect(
      db.select().from(opportunities).where(eq(opportunities.slug, 'refined-mine')).get()?.status,
    ).toBe('archived');
  });
});
