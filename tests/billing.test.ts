import { beforeEach, describe, expect, it, vi } from 'vitest';

// plans.ts reads MCP_PLAN_DAILY_CAP into a module const at import time — set
// it before any module under test is evaluated (vi.hoisted runs first)
vi.hoisted(() => {
  process.env.MCP_PLAN_DAILY_CAP = '1';
});

import { eq } from 'drizzle-orm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../mcp/build';
import type { AuthContext } from '../mcp/lib/auth';
import { _setFetch } from '@/lib/llm/minimax';
import {
  canGeneratePlan,
  cycleStart,
  entitlementFor,
  quotaFor,
  TIER_PRICES,
  TIER_PRICES_ANNUAL,
  usageThisCycle,
} from '@/lib/billing';
import { llmCalls, opportunities, planEntitlements, users } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';

const d = (s: string) => new Date(s);

describe('quotaFor', () => {
  it('maps tiers to monthly plan quotas', () => {
    expect(quotaFor('free')).toBe(3);
    expect(quotaFor('builder')).toBe(30);
    expect(quotaFor('factory')).toBe(100);
  });
});

describe('TIER_PRICES_ANNUAL', () => {
  it('is two months free vs monthly', () => {
    expect(TIER_PRICES.builder * 10).toBe(TIER_PRICES_ANNUAL.builder);
    expect(TIER_PRICES.factory * 10).toBe(TIER_PRICES_ANNUAL.factory);
  });
});

describe('cycleStart', () => {
  it('returns this month when resetDay already passed', () => {
    expect(cycleStart(10, d('2026-08-20T12:00:00Z'))).toEqual(d('2026-08-10T00:00:00Z'));
  });

  it('returns today 00:00 UTC when resetDay is today (inclusive boundary)', () => {
    expect(cycleStart(20, d('2026-08-20T12:00:00Z'))).toEqual(d('2026-08-20T00:00:00Z'));
    expect(cycleStart(20, d('2026-08-20T00:00:00Z'))).toEqual(d('2026-08-20T00:00:00Z'));
  });

  it('returns previous month when resetDay is still ahead this month', () => {
    expect(cycleStart(25, d('2026-08-20T12:00:00Z'))).toEqual(d('2026-07-25T00:00:00Z'));
  });

  it('clamps resetDay 31 to the last day of a shorter month', () => {
    // June has 30 days: on June 30 the clamped reset (June 30 00:00) has passed
    expect(cycleStart(31, d('2026-06-30T12:00:00Z'))).toEqual(d('2026-06-30T00:00:00Z'));
    // before the clamped reset the cycle started May 31 (May has 31 days)
    expect(cycleStart(31, d('2026-06-15T12:00:00Z'))).toEqual(d('2026-05-31T00:00:00Z'));
    // 2026 is not a leap year: February clamps to the 28th
    expect(cycleStart(31, d('2026-03-01T12:00:00Z'))).toEqual(d('2026-02-28T00:00:00Z'));
  });

  it('rolls over the year boundary', () => {
    // early January, resetDay not yet reached → previous December
    expect(cycleStart(15, d('2026-01-03T12:00:00Z'))).toEqual(d('2025-12-15T00:00:00Z'));
    // late December, resetDay passed → this December
    expect(cycleStart(15, d('2025-12-20T12:00:00Z'))).toEqual(d('2025-12-15T00:00:00Z'));
    // Jan 1 00:00 with resetDay 1 → exactly today
    expect(cycleStart(1, d('2026-01-01T00:00:00Z'))).toEqual(d('2026-01-01T00:00:00Z'));
  });
});

// --- db-backed quota tests ---

let db: ReturnType<typeof useTestDb>;
let userId: number;

// fixed "now" inside a cycle that starts 2026-08-01 (default resetDay=1)
const NOW = d('2026-08-20T12:00:00Z');

function seedUser(name: string): number {
  return Number(db.insert(users).values({ name, passwordHash: 'x' }).run().lastInsertRowid);
}

function seedPlanCalls(user: number | null, rows: { ts: Date; feature?: string }[]): void {
  for (const r of rows) {
    db.insert(llmCalls)
      .values({ ts: r.ts, feature: r.feature ?? 'plan', userId: user, model: 'test-model' })
      .run();
  }
}

describe('plan quota (db)', () => {
  beforeEach(() => {
    db = useTestDb();
    userId = seedUser('quota-user');
  });

  it('no entitlement row → free-tier defaults', () => {
    expect(entitlementFor(userId)).toEqual({ tier: 'free', plansPerMonth: 3, resetDay: 1 });
    expect(canGeneratePlan(userId, NOW)).toEqual({ ok: true, tier: 'free', used: 0, quota: 3 });
  });

  it('counts only this user\'s feature=plan rows inside the current cycle', () => {
    seedPlanCalls(userId, [
      { ts: d('2026-08-01T00:00:00Z') }, // cycle start is inclusive
      { ts: d('2026-08-19T23:59:59Z') },
      { ts: d('2026-07-31T23:59:59Z') }, // before the cycle — outside
      { ts: d('2026-08-10T00:00:00Z'), feature: 'curate' }, // wrong feature
    ]);
    seedPlanCalls(999, [{ ts: d('2026-08-10T00:00:00Z') }]); // different user
    expect(usageThisCycle(userId, NOW)).toBe(2);
  });

  it('boundary: used == quota blocks generation', () => {
    seedPlanCalls(userId, [{ ts: d('2026-08-02T00:00:00Z') }, { ts: d('2026-08-03T00:00:00Z') }]);
    expect(canGeneratePlan(userId, NOW)).toEqual({ ok: true, tier: 'free', used: 2, quota: 3 });
    seedPlanCalls(userId, [{ ts: d('2026-08-04T00:00:00Z') }]);
    expect(canGeneratePlan(userId, NOW)).toEqual({ ok: false, tier: 'free', used: 3, quota: 3 });
  });

  it('honors the entitlement row: tier, custom quota, custom resetDay window', () => {
    db.insert(planEntitlements).values({ userId, tier: 'builder', plansPerMonth: 30, resetDay: 15 }).run();
    // with resetDay 15 and NOW = Aug 20, the cycle started Aug 15
    seedPlanCalls(userId, [
      { ts: d('2026-08-10T00:00:00Z') }, // before Aug 15 — outside this cycle
      { ts: d('2026-08-15T00:00:00Z') }, // cycle start, inclusive
      { ts: d('2026-08-19T00:00:00Z') },
    ]);
    expect(usageThisCycle(userId, NOW)).toBe(2);
    expect(canGeneratePlan(userId, NOW)).toEqual({ ok: true, tier: 'builder', used: 2, quota: 30 });
  });

  it('cache-hit scenario: no new llm_calls rows → still allowed, usage unchanged', () => {
    seedPlanCalls(userId, [{ ts: d('2026-08-02T00:00:00Z') }, { ts: d('2026-08-03T00:00:00Z') }]);
    const before = canGeneratePlan(userId, NOW);
    expect(before).toMatchObject({ ok: true, used: 2 });
    // a cache hit writes nothing — the gate must see the same usage and stay open
    const after = canGeneratePlan(userId, NOW);
    expect(after).toMatchObject({ ok: true, used: 2, quota: 3 });
  });
});

// --- generate_plan enforcement (mirrors tests/mcp-tools.test.ts wiring) ---

const BRIEF_JSON = {
  icp: 'E-commerce operators with large catalogs who pay per-image editors',
  mvp: ['upload API', 'background removal worker', 'credit billing'],
  stackVenture: 'ai-product',
  stackNotes: null,
  unitEconomics: { assumptions: ['test'], monthlyCostUsd: 40, suggestedPriceUsd: 29, breakEvenCustomers: 2 },
  gtm: ['shopify app store'],
  risks: ['platform dependency'],
};

const FRAME_JSON = {
  title: 'Bulk background-removal API',
  overview: 'A focused API selling bulk background removal to e-commerce sellers, riding newly-cheap image models.',
  icp: 'E-commerce operators with 500+ SKUs paying per-image editors today',
  pricing: { model: 'usage credits', priceUsd: 29, notes: '10x undercut of manual editing' },
  stackVenture: 'ai-product',
};

function phaseJson(phase: string) {
  const mk = (n: number) => ({
    id: `${phase}-${n}`,
    title: `${phase} task ${n}`,
    detail: `Concrete instructions for ${phase} task ${n}, long enough to validate.`,
    dependsOn: [],
    filesToTouch: ['src/index.ts'],
    tools: ['next'],
    acceptance: [`${phase} task ${n} observable criterion`],
    verify: 'npm test',
    estimateHours: 2,
    rollback: 'git revert',
  });
  return { goal: `${phase} goal sentence, long enough.`, tasks: [mk(1), mk(2)] };
}

function mockMinimax(): { calls: string[] } {
  const calls: string[] = [];
  _setFetch((async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: { content: string }[] };
    const system = body.messages[0]!.content;
    const user = body.messages[1]!.content;
    let payload: unknown;
    if (system.includes('launch brief')) {
      payload = BRIEF_JSON;
      calls.push('brief');
    } else if (user.includes('plan frame')) {
      payload = FRAME_JSON;
      calls.push('frame');
    } else {
      const m = /Write the "(\w+)" phase/.exec(user);
      if (!m) throw new Error('unexpected LLM call in test');
      payload = phaseJson(m[1]!);
      calls.push(`phase:${m[1]}`);
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: {} }),
    } as Response;
  }) as unknown as typeof fetch);
  return { calls };
}

function seedOpportunity(): void {
  db.insert(opportunities)
    .values({
      slug: 'bulk-bg-removal-api',
      title: 'Bulk background-removal API',
      thesis: 'Sellers need cheap bulk background removal; new image models make it 10x cheaper to offer.',
      sector: 'ai-media',
      status: 'active',
      flipScore: 72,
      holdScore: 55,
      scores: JSON.stringify({ demand: 16, buildability: 15 }),
      kpis: null,
      evidence: '[]',
      verdict: 'pursue',
      confidence: 60,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    .run();
}

async function wire(auth: AuthContext): Promise<Client> {
  const server = buildServer(auth);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'billing-test', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as {
    structuredContent?: Record<string, unknown>;
    content?: { type: string; text: string }[];
  };
}

function authedAuth(uid: number): AuthContext {
  return { authed: true, userId: uid, scopes: new Set(['read', 'plans']), rateKey: `user:${uid}` };
}

const ANON: AuthContext = {
  authed: false,
  userId: null,
  scopes: new Set(['read', 'plans']),
  rateKey: 'anon-billing',
};

describe('generate_plan quota enforcement', () => {
  beforeEach(() => {
    db = useTestDb();
    process.env.MINIMAX_API_KEY = 'test-key';
  });

  it('rejects an authed user over the free quota with tier + upgrade hint, before any LLM call', async () => {
    const uid = seedUser('over-quota');
    // free quota is 3/cycle; simulate a fully-used cycle (rows inside the
    // current real cycle — default resetDay 1, ts = now)
    seedPlanCalls(uid, [{ ts: new Date() }, { ts: new Date() }, { ts: new Date() }]);
    seedOpportunity();
    const { calls } = mockMinimax();
    const client = await wire(authedAuth(uid));

    const res = await call(client, 'generate_plan', { opportunity: 'bulk-bg-removal-api' });
    expect(res.structuredContent).toMatchObject({ ok: false });
    const err = String(res.structuredContent!.error);
    expect(err).toContain('"free"');
    expect(err).toContain('3/3');
    expect(err).toContain('upgrade to builder for 30 plans/mo');
    expect(err).toContain('/pricing');
    expect(calls).toHaveLength(0); // rejected at entry — zero LLM spend
  });

  it('authed users are gated by the monthly entitlement, not the flat daily cap', async () => {
    const uid = seedUser('builder-user');
    db.insert(planEntitlements).values({ userId: uid, tier: 'builder', plansPerMonth: 30, resetDay: 1 }).run();
    seedOpportunity();
    mockMinimax();
    const client = await wire(authedAuth(uid));
    const planRows = () => db.select().from(llmCalls).where(eq(llmCalls.userId, uid)).all().length;

    // MCP_PLAN_DAILY_CAP is 1 in this file: the anonymous flat cap would block
    // a second generation — the monthly entitlement (30) must not
    const first = await call(client, 'generate_plan', { opportunity: 'bulk-bg-removal-api' });
    expect(first.structuredContent).toMatchObject({ ok: true, cached: false });
    const afterFirst = planRows();
    expect(afterFirst).toBeGreaterThan(0); // metered in llm_calls with this userId

    const second = await call(client, 'generate_plan', { opportunity: 'bulk-bg-removal-api', force: true });
    expect(second.structuredContent).toMatchObject({ ok: true, cached: false });
    expect(planRows()).toBeGreaterThan(afterFirst); // second generation metered too
  });

  it('anonymous callers keep the old flat daily cap; cached plans stay available via get_plan', async () => {
    seedOpportunity();
    mockMinimax();
    const client = await wire(ANON);

    const first = await call(client, 'generate_plan', { opportunity: 'bulk-bg-removal-api' });
    expect(first.structuredContent).toMatchObject({ ok: true, cached: false });

    // cap is 1/day: the next generate_plan is refused even though a cache exists
    const second = await call(client, 'generate_plan', { opportunity: 'bulk-bg-removal-api' });
    expect(second.structuredContent).toMatchObject({ ok: false });
    expect(String(second.structuredContent!.error)).toContain('daily plan generation cap reached (1)');

    const cached = await call(client, 'get_plan', { opportunity: 'bulk-bg-removal-api' });
    expect(cached.structuredContent).toMatchObject({ found: true });
  });
});
