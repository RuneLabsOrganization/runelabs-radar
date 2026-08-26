import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/opportunities/forge', () => ({ forgeOpportunity: vi.fn() }));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthContext } from '../mcp/lib/auth';
import { registerForgeTools } from '../mcp/tools/forge';
import { forgeOpportunity } from '@/lib/opportunities/forge';
import { opportunities, planEntitlements } from '@/lib/db/schema';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

const forgeMock = vi.mocked(forgeOpportunity);

function authFor(userId: number | null): AuthContext {
  return {
    authed: userId != null, userId, scopes: new Set(['read', 'plans']),
    rateKey: userId != null ? `user:${userId}` : 'ip:test',
  };
}

async function wire(userId: number | null): Promise<Client> {
  const server = new McpServer({ name: 'forge-test', version: '0.0.1' });
  registerForgeTools(server, authFor(userId));
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

function seedOpp(db: Db, slug: string, ownerUserId: number | null) {
  const now = new Date();
  db.insert(opportunities)
    .values({
      slug, ownerUserId, title: `Title for ${slug}`,
      thesis: 'A sufficiently long thesis for the forge tool to reference.',
      sector: 'devtools', status: 'active', flipScore: 70, holdScore: 50,
      scores: '{}', evidence: '[]', firstSeenAt: now, lastSeenAt: now,
    })
    .run();
}

describe('forge_opportunity', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    seedUser(db, 1);
    seedUser(db, 9);
    forgeMock.mockReset();
    forgeMock.mockResolvedValue({
      ok: true, flipScore: 62, holdScore: 48, verdict: 'watch', confidence: 55,
      killRisks: ['Platform absorbs it'], conditionsToSucceed: ['own a channel'],
      strengthenedVariants: ['niche down'],
    });
    db.insert(planEntitlements)
      .values({ userId: 1, tier: 'builder', plansPerMonth: 30, resetDay: 1 })
      .run();
    seedOpp(db, 'forge-me', 1);
  });

  it('forges and returns the debate outcome', async () => {
    const res = await (await wire(1))
      .callTool({ name: 'forge_opportunity', arguments: { opportunity: 'forge-me' } });
    const p = res.structuredContent as { ok: boolean; kill_risks: string[]; verdict: string };
    expect(p.ok).toBe(true);
    expect(p.verdict).toBe('watch');
    expect(p.kill_risks).toContain('Platform absorbs it');
  });

  it('blocks free tier with an upgrade hint and spends nothing', async () => {
    seedOpp(db, 'free-attempt', 9);
    const res = await (await wire(9))
      .callTool({ name: 'forge_opportunity', arguments: { opportunity: 'free-attempt' } });
    const p = res.structuredContent as { ok: boolean; error: string };
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/builder/i);
    expect(forgeMock).not.toHaveBeenCalled();
  });

  it('requires sign-in', async () => {
    const res = await (await wire(null))
      .callTool({ name: 'forge_opportunity', arguments: { opportunity: 'forge-me' } });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(false);
    expect(forgeMock).not.toHaveBeenCalled();
  });

  it('reports an unknown slug without spending', async () => {
    const res = await (await wire(1))
      .callTool({ name: 'forge_opportunity', arguments: { opportunity: 'nope' } });
    expect((res.structuredContent as { ok: boolean }).ok).toBe(false);
    expect(forgeMock).not.toHaveBeenCalled();
  });
});
