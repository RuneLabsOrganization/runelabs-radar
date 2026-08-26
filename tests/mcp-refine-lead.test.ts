import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerLeadTools } from '../mcp/tools/leads';
import { insertLeads } from '@/lib/opportunities/leads';
import type { LeadDraft } from '@/lib/opportunities/compose';
import { SUB_KEYS } from '@/lib/opportunities/engine';
import { leads, opportunities } from '@/lib/db/schema';
import { _setFetch } from '@/lib/llm/minimax';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function draft(slug: string): LeadDraft {
  return {
    slug, title: `Title for ${slug}`,
    thesisSkeleton: 'A composed skeleton awaiting refinement.',
    sector: 'devtools', primitiveRefs: ['P1'],
    wedge: {
      business_model: 'subscription-saas', delivery_form: 'cli-tool',
      buyer: 'solo-builder', moat_play: 'workflow-lock-in',
    },
    heuristicScore: 60, combinationIndex: 7,
  };
}

function stubLlm(slug: string) {
  const subScores = Object.fromEntries(SUB_KEYS.map((k) => [k, 12]));
  _setFetch(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          openings: [{
            slug, title: 'Review queue triage for small teams',
            thesis: 'Small engineering teams lose a day a week to review backlogs; triage it and charge per seat.',
            sector: 'devtools', window: '6 months', windowMonths: 6, subScores,
            kpis: {
              initialCostUsd: 200, monthlyCostUsd: 80, priceUsd: 25, timeToMvpDays: 21,
              breakEvenCustomers: 6, competitorCount: 4, competitionNote: null, regulatoryNote: null,
            },
            evidenceRefs: [],
          }],
        }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

function authFor(userId: number | null, rateKey: string): AuthContext {
  return { authed: userId != null, userId, scopes: new Set(['read', 'plans']), rateKey };
}

async function wire(auth: AuthContext): Promise<Client> {
  const server = new McpServer({ name: 'refine-test', version: '0.0.1' });
  registerLeadTools(server, auth);
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

describe('refine_lead', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    seedUser(db, 1);
    seedUser(db, 2);
    vi.stubEnv('MINIMAX_API_KEY', 'test-key');
  });

  it('promotes a lead into the caller private opportunity', async () => {
    insertLeads({ ownerKey: 'user:1', userId: 1 }, [draft('review-queue')]);
    stubLlm('review-queue');

    const res = await (await wire(authFor(1, 'user:1')))
      .callTool({ name: 'refine_lead', arguments: { lead: 'review-queue' } });
    const p = res.structuredContent as { ok: boolean; opportunity?: { slug: string } };
    expect(p.ok).toBe(true);

    const rows = db.select().from(opportunities).where(eq(opportunities.ownerUserId, 1)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerUserId).toBe(1);
  });

  it('refuses a lead that belongs to someone else', async () => {
    insertLeads({ ownerKey: 'user:2', userId: 2 }, [draft('not-yours')]);
    const res = await (await wire(authFor(1, 'user:1')))
      .callTool({ name: 'refine_lead', arguments: { lead: 'not-yours' } });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(false);
  });

  it('requires sign-in', async () => {
    insertLeads({ ownerKey: 'ip:1.2.3.4', userId: null }, [draft('anon-lead')]);
    const res = await (await wire(authFor(null, 'ip:1.2.3.4')))
      .callTool({ name: 'refine_lead', arguments: { lead: 'anon-lead' } });
    const p = res.structuredContent as { ok: boolean; error?: string };
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/sign in/i);
  });

  it('does not markRefined when the refiner returns only a foreign slug', async () => {
    insertLeads({ ownerKey: 'user:1', userId: 1 }, [draft('review-queue')]);
    stubLlm('totally-different-slug');

    const res = await (await wire(authFor(1, 'user:1')))
      .callTool({ name: 'refine_lead', arguments: { lead: 'review-queue' } });
    const p = res.structuredContent as { ok: boolean; error?: string };
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/Could not score this lead/i);

    const row = db.select().from(leads).where(eq(leads.ownerKey, 'user:1')).get();
    expect(row?.stage).toBe('composed');
    expect(row?.opportunityId).toBeNull();
    expect(db.select().from(opportunities).where(eq(opportunities.ownerUserId, 1)).all()).toHaveLength(0);
  });
});
