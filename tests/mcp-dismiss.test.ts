import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerLeadTools } from '../mcp/tools/leads';
import { insertLeads, listLeads } from '@/lib/opportunities/leads';
import type { LeadDraft } from '@/lib/opportunities/compose';
import { getProfile, setProfile } from '@/lib/personalization';
import { planEntitlements } from '@/lib/db/schema';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function draft(slug: string, sector: string): LeadDraft {
  return {
    slug, title: `Title for ${slug}`, thesisSkeleton: 'A composed skeleton.',
    sector, primitiveRefs: ['P1'], primitiveType: 'pain',
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
  registerLeadTools(server, authFor(userId));
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

describe('dismiss_opportunity', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    seedUser(db, 1);
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
});
