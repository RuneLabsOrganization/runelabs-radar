import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../mcp/build';
import type { AuthContext } from '../mcp/lib/auth';
import { kitEvidence, kitPicks } from '@/lib/db/schema';
import { seedUser, useTestDb } from './helpers/db';

const AUTH: AuthContext = {
  authed: false,
  userId: null,
  scopes: new Set(['read', 'plans']),
  rateKey: 'test',
};

async function wire(auth: AuthContext = AUTH): Promise<Client> {
  const server = buildServer(auth);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-test', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    structuredContent?: Record<string, any>;
  };
  return res.structuredContent!;
}

describe('kit MCP tools', () => {
  beforeEach(() => {
    const db = useTestDb();
    db.insert(kitPicks)
      .values({
        category: 'video',
        task: 'text-to-video',
        tier: 'cheapest',
        pickName: 'VidThing',
        priceModel: 'seat',
        priceUsdMonth: 20,
        why: 'cheapest that holds motion',
        confidence: 'high',
        evidenceCount: 34,
        distinctSources: 4,
        verifiedAt: new Date('2026-08-23T00:00:00Z'),
        updatedAt: new Date('2026-08-23T00:00:00Z'),
      })
      .run();
  });

  it('list_kits returns the roster', async () => {
    const out = await call(await wire(), 'list_kits');
    expect(out.count).toBe(11);
    expect(out.kits.map((k: any) => k.persona)).toContain('ugc-creator');
  });

  it('get_kit returns a costed kit with gaps', async () => {
    const out = await call(await wire(), 'get_kit', { persona: 'ugc-creator' });
    expect(out.found).toBe(true);
    expect(out.tier).toBe('cheapest'); // persona default
    expect(out.total_usd_month).toBe(20);
    expect(out.covered).toBe(1);
    expect(out.total_cells).toBe(6);
    expect(out.gaps).toHaveLength(5);
    const line = out.lines.find((l: any) => l.task === 'text-to-video');
    expect(line.pick).toBe('VidThing');
    expect(line.confidence).toBe('high');
  });

  it('get_kit honours an explicit tier', async () => {
    const out = await call(await wire(), 'get_kit', { persona: 'ugc-creator', tier: 'best' });
    expect(out.tier).toBe('best');
    expect(out.covered).toBe(0);
  });

  it('get_kit on an unknown persona lists the available slugs', async () => {
    const out = await call(await wire(), 'get_kit', { persona: 'astronaut' });
    expect(out.found).toBe(false);
    expect(out.available).toContain('filmmaker');
  });

  it('get_kit excludes cells on request', async () => {
    const out = await call(await wire(), 'get_kit', {
      persona: 'ugc-creator',
      exclude: ['audio/music'],
    });
    expect(out.total_cells).toBe(5);
  });
});

const AUTHED: AuthContext = {
  authed: true,
  userId: 1,
  scopes: new Set(['read', 'plans']),
  rateKey: 'test-authed',
};

describe('explain_pick and saved kits', () => {
  beforeEach(() => {
    const db = useTestDb();
    seedUser(db, 1);
    const pickId = db
      .insert(kitPicks)
      .values({
        category: 'video',
        task: 'text-to-video',
        tier: 'cheapest',
        pickName: 'VidThing',
        priceModel: 'seat',
        priceUsdMonth: 20,
        why: 'cheapest that holds motion',
        confidence: 'high',
        evidenceCount: 1,
        distinctSources: 1,
        verifiedAt: new Date('2026-08-23T00:00:00Z'),
        updatedAt: new Date('2026-08-23T00:00:00Z'),
      })
      .returning({ id: kitPicks.id })
      .get()!.id;
    db.insert(kitEvidence)
      .values({
        pickId,
        kind: 'report',
        sourceUrl: 'https://example.com/thread',
        excerpt: 'held motion better than the alternatives at this price',
        sentiment: 1,
        observedAt: new Date('2026-08-22T00:00:00Z'),
      })
      .run();
  });

  it('explain_pick returns the evidence receipts', async () => {
    const out = await call(await wire(), 'explain_pick', {
      category: 'video',
      task: 'text-to-video',
      tier: 'cheapest',
    });
    expect(out.found).toBe(true);
    expect(out.pick).toBe('VidThing');
    expect(out.evidence).toHaveLength(1);
    expect(out.evidence[0].source_url).toBe('https://example.com/thread');
  });

  it('explain_pick reports an uncovered cell honestly', async () => {
    const out = await call(await wire(), 'explain_pick', {
      category: 'video',
      task: 'avatar',
      tier: 'cheapest',
    });
    expect(out.found).toBe(false);
  });

  it('set_my_kit then get_my_kit round-trips', async () => {
    const client = await wire(AUTHED);
    const saved = await call(client, 'set_my_kit', { persona: 'ugc-creator', tier: 'cheapest' });
    expect(saved.ok).toBe(true);
    const mine = await call(client, 'get_my_kit');
    expect(mine.found).toBe(true);
    expect(mine.persona).toBe('ugc-creator');
    expect(mine.total_usd_month).toBe(20);
  });

  it('get_my_kit reports no saved persona rather than guessing', async () => {
    const out = await call(await wire(AUTHED), 'get_my_kit');
    expect(out.found).toBe(false);
  });

  it('set_my_kit requires auth', async () => {
    const out = await call(await wire(), 'set_my_kit', { persona: 'ugc-creator' });
    expect(out.ok).toBe(false);
  });

  it('set_my_kit rejects an unknown persona', async () => {
    const out = await call(await wire(AUTHED), 'set_my_kit', { persona: 'astronaut' });
    expect(out.ok).toBe(false);
    expect(out.available).toContain('agency');
  });
});
