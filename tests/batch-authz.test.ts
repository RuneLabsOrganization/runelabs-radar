import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { eq } from 'drizzle-orm';
import { batches, batchItems, batchRunItems, batchRuns, llmCalls, opportunities, planEntitlements, stacks } from '@/lib/db/schema';
import {
  canModifyBatch,
  canViewBatch,
  createWorkspaceBatch,
  getBatchBySlug,
  runBatchOp,
} from '@/lib/batches';
import { generatePlan } from '@/lib/plans/generate';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import type { AuthContext } from '../mcp/lib/auth';
import { registerBatchTools } from '../mcp/tools/batches';
import { POST as itemsPost } from '@/app/api/batches/[id]/items/route';
import { POST as runPost } from '@/app/api/batches/[id]/run/route';
import { POST as stackVerdictsPost } from '@/app/api/stack-verdicts/route';

const hooks = vi.hoisted(() => ({ meter: { current: null as null | (() => void) } }));
vi.mock('@/lib/plans/generate', () => ({
  generatePlan: vi.fn(async () => {
    hooks.meter.current?.();
    return { ok: true as const, plan: {}, cached: false };
  }),
}));

let currentUser: { id: number; name: string; role: 'admin' | 'member' } | null = null;
vi.mock('@/lib/auth/user', () => ({
  requireApiUser: vi.fn(async () => currentUser),
  getCurrentUser: vi.fn(async () => currentUser),
  requireViewer: vi.fn(async () => currentUser),
}));

const planMock = vi.mocked(generatePlan);

function authFor(userId: number | null): AuthContext {
  return { authed: userId != null, userId, scopes: new Set(['read']), rateKey: `user:${userId ?? 'anon'}` };
}

async function wire(auth: AuthContext): Promise<Client> {
  const server = new McpServer({ name: 'batches-test', version: '0.0.1' });
  registerBatchTools(server, auth);
  const client = new Client({ name: 'test', version: '0.0.1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(c), server.connect(s)]);
  return client;
}

function seedBatch(db: Db, opts: { slug: string; ownerId: number | null; visibility: 'private' | 'members' | 'public' }) {
  const now = new Date();
  return db
    .insert(batches)
    .values({
      ownerId: opts.ownerId,
      kind: opts.ownerId == null ? 'drop' : 'workspace',
      slug: opts.slug,
      title: `Batch ${opts.slug}`,
      visibility: opts.visibility,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()!;
}

function jsonReq(body: unknown): Request {
  return new Request('http://localhost/', { method: 'POST', body: JSON.stringify(body) });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

let db: Db;

beforeEach(() => {
  db = useTestDb();
  currentUser = null;
  hooks.meter.current = null;
  planMock.mockClear();
});

describe('canViewBatch / canModifyBatch', () => {
  it('private batches are owner-only', () => {
    seedUser(db, 1);
    const b = seedBatch(db, { slug: 'priv', ownerId: 1, visibility: 'private' });
    expect(canViewBatch(b, 1)).toBe(true);
    expect(canViewBatch(b, 2)).toBe(false);
    expect(canViewBatch(b, null)).toBe(false);
    expect(canModifyBatch(b, 1)).toBe(true);
    expect(canModifyBatch(b, 2)).toBe(false);
  });

  it('members batches require a signed-in user', () => {
    const b = seedBatch(db, { slug: 'drop', ownerId: null, visibility: 'members' });
    expect(canViewBatch(b, null)).toBe(false);
    expect(canViewBatch(b, 42)).toBe(true);
    // system drops are read-only — not even members may add items
    expect(canModifyBatch(b, 42)).toBe(false);
  });
});

describe('batch item/run API authorization', () => {
  beforeEach(() => {
    seedUser(db, 1);
    seedUser(db, 2);
  });

  it('rejects writes into curated drops (ownerId null)', async () => {
    currentUser = { id: 1, name: 'alice', role: 'member' };
    const drop = seedBatch(db, { slug: 'radar-2026-w36', ownerId: null, visibility: 'members' });
    const res = await itemsPost(jsonReq({ refType: 'idea', ideaText: 'injected idea' }), ctx(String(drop.id)));
    expect(res.status).toBe(404);
  });

  it('rejects writes into another user’s batch', async () => {
    currentUser = { id: 2, name: 'bob', role: 'member' };
    const b = seedBatch(db, { slug: 'alice-batch', ownerId: 1, visibility: 'private' });
    const res = await itemsPost(jsonReq({ refType: 'idea', ideaText: 'x' }), ctx(String(b.id)));
    expect(res.status).toBe(404);
  });

  it('accepts writes into the caller’s own batch', async () => {
    currentUser = { id: 1, name: 'alice', role: 'member' };
    const b = createWorkspaceBatch(1, 'Mine');
    const res = await itemsPost(jsonReq({ refType: 'idea', ideaText: 'my idea' }), ctx(String(b.id)));
    expect(res.status).toBe(200);
  });

  it('rejects a non-string refType cast', async () => {
    currentUser = { id: 1, name: 'alice', role: 'member' };
    const b = createWorkspaceBatch(1, 'Mine2');
    const res = await itemsPost(jsonReq({ refType: 'garbage', ideaText: 'x' }), ctx(String(b.id)));
    expect(res.status).toBe(400);
  });

  it('rejects runs on another user’s batch and non-integer ids', async () => {
    currentUser = { id: 2, name: 'bob', role: 'member' };
    const b = seedBatch(db, { slug: 'alice-run', ownerId: 1, visibility: 'private' });
    const res = await runPost(jsonReq({ op: 'debate' }), ctx(String(b.id)));
    expect(res.status).toBe(404);
    const bad = await runPost(jsonReq({ op: 'debate' }), ctx('3.5'));
    expect(bad.status).toBe(400);
  });
});

describe('runBatchOp enforces quota per item', () => {
  it('stops at the monthly plan quota instead of running the whole batch', async () => {
    seedUser(db, 1);
    db.insert(planEntitlements).values({ userId: 1, tier: 'builder', plansPerMonth: 2, resetDay: 1 }).run();
    // one plan already consumed this cycle
    db.insert(llmCalls)
      .values({ ts: new Date(), feature: 'plan', userId: 1, model: 'test' })
      .run();
    // the (mocked) generator meters one llm_calls row per generation, like the real one
    hooks.meter.current = () => {
      db.insert(llmCalls).values({ ts: new Date(), feature: 'plan', userId: 1, model: 'test' }).run();
    };
    const b = createWorkspaceBatch(1, 'Quota batch');
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const opp = db
        .insert(opportunities)
        .values({
          slug: `quota-opp-${i}`,
          ownerUserId: 1,
          title: `Quota opp ${i}`,
          thesis: 'A sufficiently long thesis to satisfy downstream validation.',
          sector: 'devtools',
          status: 'active',
          flipScore: 60,
          holdScore: 50,
          scores: '{}',
          evidence: '[]',
          verdict: 'pursue',
          confidence: 60,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .returning()
        .get()!;
      db.insert(batchItems)
        .values({ batchId: b.id, refType: 'opportunity', refId: opp.id, position: i, createdAt: now })
        .run();
    }

    const run = await runBatchOp(b.id, 'plan', 1);

    expect(planMock).toHaveBeenCalledTimes(1); // NOT 3 — quota 2, usage started at 1
    const stats = JSON.parse(run.stats!) as { total: number; ok: number; error: number };
    expect(stats).toEqual({ total: 3, ok: 1, error: 2 });
    const errors = db.select().from(batchRunItems).all().map((r) => r.error);
    expect(errors.filter((e) => e?.includes('Plan quota reached'))).toHaveLength(2);
  });
});

describe('MCP batch tools authorization', () => {
  beforeEach(() => {
    seedUser(db, 1);
    seedUser(db, 2);
  });

  it('get_batch hides other users’ private batches and drops from anonymous callers', async () => {
    const priv = seedBatch(db, { slug: 'alice-mcp', ownerId: 1, visibility: 'private' });
    seedBatch(db, { slug: 'radar-drop', ownerId: null, visibility: 'members' });
    const stranger = await wire(authFor(2));
    const res1 = (await stranger.callTool({ name: 'get_batch', arguments: { slug: priv.slug } }))
      .structuredContent as { found: boolean };
    expect(res1.found).toBe(false);
    const anon = await wire(authFor(null));
    const res2 = (await anon.callTool({ name: 'get_batch', arguments: { slug: 'radar-drop' } }))
      .structuredContent as { found: boolean };
    expect(res2.found).toBe(false);
  });

  it('add_to_batch refuses curated drops', async () => {
    seedBatch(db, { slug: 'radar-drop-2', ownerId: null, visibility: 'members' });
    const client = await wire(authFor(1));
    const res = (await client.callTool({
      name: 'add_to_batch',
      arguments: { slug: 'radar-drop-2', ref_type: 'idea', idea_text: 'injected' },
    })).structuredContent as { ok: boolean };
    expect(res.ok).toBe(false);
  });

  it('run_batch and get_batch_run refuse other users’ batches', async () => {
    const b = seedBatch(db, { slug: 'alice-run-mcp', ownerId: 1, visibility: 'private' });
    const runRow = db
      .insert(batchRuns)
      .values({ batchId: b.id, op: 'debate', status: 'ok', requestedBy: 1, createdAt: new Date() })
      .returning()
      .get()!;
    const stranger = await wire(authFor(2));
    const run = (await stranger.callTool({ name: 'run_batch', arguments: { slug: b.slug, op: 'debate' } }))
      .structuredContent as { ok: boolean };
    expect(run.ok).toBe(false);
    const getRun = (await stranger.callTool({ name: 'get_batch_run', arguments: { run_id: runRow.id } }))
      .structuredContent as { found: boolean };
    expect(getRun.found).toBe(false);
  });
});

describe('stack verdicts are admin-only', () => {
  it('rejects members and anonymous callers, accepts admins', async () => {
    seedUser(db, 1);
    const stack = db
      .insert(stacks)
      .values({ venture: 'radar', title: 'Radar', layers: '[]', updatedAt: new Date() })
      .returning()
      .get()!;

    currentUser = null;
    expect((await stackVerdictsPost(jsonReq({ stackId: stack.id, verdict: 'x' }))).status).toBe(401);

    currentUser = { id: 1, name: 'alice', role: 'member' };
    expect((await stackVerdictsPost(jsonReq({ stackId: stack.id, verdict: 'x' }))).status).toBe(403);

    currentUser = { id: 1, name: 'alice', role: 'admin' };
    const ok = await stackVerdictsPost(jsonReq({ stackId: stack.id, verdict: 'Ship it.' }));
    expect(ok.status).toBe(200);
    expect(db.select().from(stacks).where(eq(stacks.id, stack.id)).get()?.runelabsVerdict).toBe('Ship it.');
  });
});
