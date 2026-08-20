import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { eq } from 'drizzle-orm';
import {
  CALLS_PER_PLAN,
  dailyLlmCost,
  llmUsageByFeature,
  llmUsageByUser,
  marginByTier,
  planCostStats,
  radarScoreDivergence,
  usageReport,
} from '@/lib/usage';
import { llmCalls, metricPoints, users } from '@/lib/db/schema';
import { registerUsageTools } from '../mcp/tools/usage';
import type { AuthContext } from '../mcp/lib/auth';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;

const DAY_MS = 864e5;
const day = (d: Date) => d.toISOString().slice(0, 10);

beforeEach(() => {
  db = useTestDb();
});

function seedUser(name: string, role: 'admin' | 'member'): number {
  db.insert(users).values({ name, passwordHash: 'test', role }).run();
  return db.select({ id: users.id }).from(users).where(eq(users.name, name)).get()!.id;
}

function seedCall(over: Partial<typeof llmCalls.$inferInsert> = {}): void {
  db.insert(llmCalls)
    .values({
      ts: new Date(),
      feature: 'curate',
      model: 'MiniMax-M2',
      promptTokens: 1000,
      completionTokens: 500,
      durationMs: 2000,
      estCostUsd: 0.001,
      ...over,
    })
    .run();
}

/**
 * Standard fixture: 5 calls across 2 days, 3 features, 3 user buckets.
 * today:    plan A (alice, $0.001), plan B (alice, $0.003), curate (anon, $0.002)
 * yesterday: plan C (bob, $0.0005), brief (anon, $0.0004)
 */
function seedStandard(): { alice: number; bob: number; yesterday: Date } {
  const alice = seedUser('alice', 'admin');
  const bob = seedUser('bob', 'member');
  const yesterday = new Date(Date.now() - DAY_MS);
  seedCall({ feature: 'plan', userId: alice, promptTokens: 1000, completionTokens: 500, durationMs: 1000, estCostUsd: 0.001 });
  seedCall({ feature: 'plan', userId: alice, promptTokens: 3000, completionTokens: 1500, durationMs: 3000, estCostUsd: 0.003 });
  seedCall({ feature: 'curate', userId: null, promptTokens: 2000, completionTokens: 1000, durationMs: 4000, estCostUsd: 0.002 });
  seedCall({ feature: 'plan', userId: bob, ts: yesterday, promptTokens: 500, completionTokens: 250, durationMs: 500, estCostUsd: 0.0005 });
  seedCall({ feature: 'brief', userId: null, ts: yesterday, promptTokens: 400, completionTokens: 200, durationMs: 800, estCostUsd: 0.0004 });
  return { alice, bob, yesterday };
}

describe('dailyLlmCost', () => {
  it('zero-fills the window and buckets cost/calls per UTC day', () => {
    const { yesterday } = seedStandard();
    const daily = dailyLlmCost(30);
    expect(daily).toHaveLength(30);

    const today = daily.find((d) => d.date === day(new Date()))!;
    expect(today.calls).toBe(3);
    expect(today.costUsd).toBeCloseTo(0.006, 12);

    const yday = daily.find((d) => d.date === day(yesterday))!;
    expect(yday.calls).toBe(2);
    expect(yday.costUsd).toBeCloseTo(0.0009, 12);

    const fiveDaysAgo = daily.find((d) => d.date === day(new Date(Date.now() - 5 * DAY_MS)))!;
    expect(fiveDaysAgo).toMatchObject({ calls: 0, costUsd: 0 });
  });

  it('excludes rows older than the window', () => {
    seedCall({ ts: new Date(Date.now() - 40 * DAY_MS), estCostUsd: 9 });
    const daily = dailyLlmCost(30);
    expect(daily.reduce((a, d) => a + d.calls, 0)).toBe(0);
    expect(daily.reduce((a, d) => a + d.costUsd, 0)).toBe(0);
  });
});

describe('llmUsageByFeature', () => {
  it('aggregates calls, tokens, cost and avg duration per feature', () => {
    seedStandard();
    const rows = llmUsageByFeature(30);
    // sorted by cost desc: plan ($0.0045) > curate ($0.002) > brief ($0.0004)
    expect(rows.map((r) => r.feature)).toEqual(['plan', 'curate', 'brief']);

    const plan = rows[0]!;
    expect(plan.calls).toBe(3);
    expect(plan.promptTokens).toBe(4500);
    expect(plan.completionTokens).toBe(2250);
    expect(plan.costUsd).toBeCloseTo(0.0045, 12);
    expect(plan.avgDurationMs).toBe(1500); // (1000+3000+500)/3

    expect(rows[1]).toMatchObject({ calls: 1, promptTokens: 2000, completionTokens: 1000, avgDurationMs: 4000 });
    expect(rows[2]).toMatchObject({ calls: 1, avgDurationMs: 800 });
  });
});

describe('llmUsageByUser', () => {
  it('aggregates per user, joins users.name, null userId = pipeline', () => {
    const { alice } = seedStandard();
    const rows = llmUsageByUser(30);
    // alice $0.004 > anon $0.0024 > bob $0.0005
    expect(rows).toHaveLength(3);

    const a = rows[0]!;
    expect(a.userId).toBe(alice);
    expect(a.name).toBe('alice');
    expect(a.calls).toBe(2);
    expect(a.promptTokens).toBe(4000);
    expect(a.completionTokens).toBe(2000);
    expect(a.costUsd).toBeCloseTo(0.004, 12);
    expect(a.avgDurationMs).toBe(2000);

    const anon = rows.find((r) => r.userId === null)!;
    expect(anon.name).toBeNull();
    expect(anon.calls).toBe(2);
    expect(anon.costUsd).toBeCloseTo(0.0024, 12);

    const bob = rows.find((r) => r.name === 'bob')!;
    expect(bob.calls).toBe(1);
    expect(bob.costUsd).toBeCloseTo(0.0005, 12);
  });

  it('survives a userId with no users row (name null)', () => {
    seedCall({ userId: 9999 });
    const rows = llmUsageByUser(30);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 9999, name: null, calls: 1 });
  });
});

describe('planCostStats', () => {
  it("counts feature='plan' rows with total and per-plan averages", () => {
    seedStandard();
    const stats = planCostStats(30);
    expect(stats.calls).toBe(3);
    expect(stats.totalCostUsd).toBeCloseTo(0.0045, 12);
    expect(stats.avgCostPerCallUsd).toBeCloseTo(0.0015, 12);
    expect(stats.avgCostPerPlanUsd).toBeCloseTo(0.0015 * CALLS_PER_PLAN, 12);
  });

  it('returns null averages when no plan rows exist', () => {
    seedCall({ feature: 'curate' });
    const stats = planCostStats(30);
    expect(stats).toMatchObject({ calls: 0, totalCostUsd: 0, avgCostPerCallUsd: null, avgCostPerPlanUsd: null });
  });
});

describe('marginByTier', () => {
  it('computes monthly cost, margin and margin % per tier from avg plan cost', () => {
    const margins = marginByTier(0.01);
    expect(margins.map((m) => m.tier)).toEqual(['free', 'builder', 'factory']);

    const free = margins[0]!;
    expect(free).toMatchObject({ priceUsd: 0, quotaPlans: 3 });
    expect(free.estMonthlyCostUsd).toBeCloseTo(0.03, 12);
    expect(free.marginUsd).toBeCloseTo(-0.03, 12);
    expect(free.marginPct).toBeNull(); // no price to divide by

    const builder = margins[1]!;
    expect(builder).toMatchObject({ priceUsd: 19, quotaPlans: 30 });
    expect(builder.estMonthlyCostUsd).toBeCloseTo(0.3, 12);
    expect(builder.marginUsd).toBeCloseTo(18.7, 12);
    expect(builder.marginPct).toBeCloseTo((18.7 / 19) * 100, 6);

    const factory = margins[2]!;
    expect(factory).toMatchObject({ priceUsd: 49, quotaPlans: 100 });
    expect(factory.estMonthlyCostUsd).toBeCloseTo(1, 12);
    expect(factory.marginPct).toBeCloseTo((48 / 49) * 100, 6);
  });

  it('returns null cost/margins (but prices and quotas) when nothing is metered', () => {
    const margins = marginByTier(null);
    for (const m of margins) {
      expect(m.estMonthlyCostUsd).toBeNull();
      expect(m.marginUsd).toBeNull();
      expect(m.marginPct).toBeNull();
    }
    expect(margins.map((m) => m.quotaPlans)).toEqual([3, 30, 100]);
  });
});

describe('radarScoreDivergence', () => {
  it('reads only radar-score/aa_divergence points, newest first', () => {
    const createdAt = new Date();
    db.insert(metricPoints).values({ source: 'radar-score', entity: 'GPT-5', metric: 'aa_divergence', value: 12.5, date: '2026-08-19', createdAt }).run();
    db.insert(metricPoints).values({ source: 'radar-score', entity: 'GPT-5', metric: 'aa_divergence', value: 11.0, date: '2026-08-20', createdAt }).run();
    // decoys: right source wrong metric, right metric wrong source
    db.insert(metricPoints).values({ source: 'radar-score', entity: 'GPT-5', metric: 'composite', value: 88, date: '2026-08-20', createdAt }).run();
    db.insert(metricPoints).values({ source: 'aa', entity: 'GPT-5', metric: 'aa_divergence', value: 1, date: '2026-08-20', createdAt }).run();

    const rows = radarScoreDivergence();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ entity: 'GPT-5', value: 11.0, date: '2026-08-20' });
    expect(rows[1]).toMatchObject({ value: 12.5, date: '2026-08-19' });
  });

  it('returns [] when the 6e job has not run yet', () => {
    expect(radarScoreDivergence()).toEqual([]);
  });
});

describe('usageReport', () => {
  it('bundles every aggregate the page and tool render', () => {
    seedStandard();
    const report = usageReport(30);
    expect(report.windowDays).toBe(30);
    expect(report.totalCalls).toBe(5);
    expect(report.totalCostUsd).toBeCloseTo(0.0069, 12);
    expect(report.daily).toHaveLength(30);
    expect(report.byFeature.map((f) => f.feature)).toEqual(['plan', 'curate', 'brief']);
    expect(report.byUser).toHaveLength(3);
    expect(report.planCost.avgCostPerPlanUsd).toBeCloseTo(0.0015 * CALLS_PER_PLAN, 12);
    expect(report.margins).toHaveLength(3);
    expect(report.divergence).toEqual([]);
  });
});

// --- get_usage MCP tool: admin gate + full aggregates (mirrors tests/mcp-tools.test.ts) ---

function authFor(userId: number | null): AuthContext {
  return {
    authed: userId !== null,
    userId,
    scopes: new Set(['read', 'plans']),
    rateKey: userId === null ? 'ip:test' : `user:${userId}`,
  };
}

async function wire(auth: AuthContext): Promise<Client> {
  const server = new McpServer({ name: 'usage-test', version: '0.0.0' });
  registerUsageTools(server, auth);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-test', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function callUsage(client: Client, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name: 'get_usage', arguments: args })) as {
    structuredContent?: Record<string, unknown>;
    content?: { type: string; text: string }[];
  };
  return result;
}

describe('get_usage tool', () => {
  it('politely refuses anonymous callers — no aggregates, no exception', async () => {
    seedStandard();
    const client = await wire(authFor(null));
    const res = await callUsage(client);
    expect(res.structuredContent).toMatchObject({ ok: false });
    expect(res.structuredContent!.error).toContain('admin');
    expect(res.structuredContent!.summary).toContain('admin');
    expect(res.structuredContent!.daily).toBeUndefined();
    expect(res.structuredContent!.by_feature).toBeUndefined();
  });

  it('refuses an authed non-admin member', async () => {
    const bob = seedUser('bob', 'member');
    const client = await wire(authFor(bob));
    const res = await callUsage(client);
    expect(res.structuredContent).toMatchObject({ ok: false });
    expect(res.structuredContent!.daily).toBeUndefined();
  });

  it('serves full aggregates to an admin user', async () => {
    const { alice } = seedStandard();
    const client = await wire(authFor(alice));
    const res = await callUsage(client);
    const sc = res.structuredContent!;

    expect(sc.ok).toBe(true);
    expect(sc.window_days).toBe(30);
    expect(sc.total_calls).toBe(5);
    expect(sc.total_est_cost_usd).toBeCloseTo(0.0069, 6);

    const daily = sc.daily as { date: string; calls: number; est_cost_usd: number }[];
    expect(daily).toHaveLength(30);
    expect(daily.find((d) => d.date === day(new Date()))).toMatchObject({ calls: 3 });

    const byFeature = sc.by_feature as { feature: string; calls: number; est_cost_usd: number }[];
    expect(byFeature.map((f) => f.feature)).toEqual(['plan', 'curate', 'brief']);
    expect(byFeature[0]).toMatchObject({ calls: 3, prompt_tokens: 4500, completion_tokens: 2250 });

    const byUser = sc.by_user as { user_id: number | null; name: string | null; calls: number }[];
    expect(byUser.find((u) => u.name === 'alice')).toMatchObject({ user_id: alice, calls: 2 });
    expect(byUser.find((u) => u.user_id === null)).toMatchObject({ name: null, calls: 2 });

    const planCost = sc.plan_cost as { plan_calls: number; avg_cost_per_plan_usd: number };
    expect(planCost.plan_calls).toBe(3);
    expect(planCost.avg_cost_per_plan_usd).toBeCloseTo(0.0015 * CALLS_PER_PLAN, 6);

    const margins = sc.margins as { tier: string; margin_pct: number | null }[];
    expect(margins).toHaveLength(3);
    expect(margins.find((m) => m.tier === 'builder')!.margin_pct).not.toBeNull();

    expect(typeof sc.summary).toBe('string');
    expect(res.content?.[0]?.text).toContain('Source:');
  });

  it('honors the days argument and renders an empty window gracefully', async () => {
    const alice = seedUser('alice', 'admin');
    const client = await wire(authFor(alice));
    const res = await callUsage(client, { days: 7 });
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.total_calls).toBe(0);
    expect(sc.daily).toHaveLength(7);
    expect(sc.by_feature).toEqual([]);
    expect(sc.by_user).toEqual([]);
    expect(sc.plan_cost).toMatchObject({ plan_calls: 0, avg_cost_per_plan_usd: null });
    const margins = sc.margins as { est_monthly_cost_usd: number | null }[];
    expect(margins.every((m) => m.est_monthly_cost_usd === null)).toBe(true);
  });
});
