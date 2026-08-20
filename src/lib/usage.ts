import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { TIER_PRICES, type Tier } from './billing';
import { getDb } from './db';
import { llmCalls, metricPoints, users } from './db/schema';

const DAY_MS = 864e5;

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * One plan generation = 6 metered calls tagged 'plan' + 'plan-phase' (1 frame
 * + 5 phases; the one-time brief bootstrap is tagged 'opportunity-brief' and
 * not counted here). llm_calls rows carry no run id, so the per-generation
 * unit cost is estimated as avg per-call cost × this constant.
 */
export const CALLS_PER_PLAN = 6;

/**
 * Plan-generation quota per tier (plans/month). Phase 8a makes billing.ts the
 * source of truth (quotaFor(tier)); until then these mirror the
 * plan_entitlements defaults in schema.ts — keep them in sync.
 */
export const TIER_PLAN_QUOTAS: Record<Tier, number> = { free: 3, builder: 30, factory: 100 };

export interface DailyCost {
  date: string; // YYYY-MM-DD (UTC)
  calls: number;
  costUsd: number;
}

/** Daily metered LLM cost (zero-filled) over the trailing window — the 7d chart series. */
export function dailyLlmCost(days = 30): DailyCost[] {
  const db = getDb();
  const rows = db
    .select({ ts: llmCalls.ts, estCostUsd: llmCalls.estCostUsd })
    .from(llmCalls)
    .where(gte(llmCalls.ts, new Date(Date.now() - days * DAY_MS)))
    .all();

  const byDate = new Map<string, DailyCost>();
  for (let i = 0; i < days; i++) {
    const date = utcDay(new Date(Date.now() - (days - 1 - i) * DAY_MS));
    byDate.set(date, { date, calls: 0, costUsd: 0 });
  }
  for (const row of rows) {
    const bucket = byDate.get(utcDay(row.ts));
    if (!bucket) continue;
    bucket.calls += 1;
    bucket.costUsd += row.estCostUsd;
  }
  return [...byDate.values()];
}

interface Accumulator {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  durationMs: number;
}

function newAccumulator(): Accumulator {
  return { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, durationMs: 0 };
}

function finish(acc: Accumulator) {
  return {
    calls: acc.calls,
    promptTokens: acc.promptTokens,
    completionTokens: acc.completionTokens,
    costUsd: acc.costUsd,
    avgDurationMs: Math.round(acc.durationMs / acc.calls),
  };
}

export interface FeatureUsage {
  feature: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  avgDurationMs: number;
}

/** Per-feature aggregates over the trailing window, most expensive first. */
export function llmUsageByFeature(days = 30): FeatureUsage[] {
  const db = getDb();
  const rows = db
    .select({
      feature: llmCalls.feature,
      promptTokens: llmCalls.promptTokens,
      completionTokens: llmCalls.completionTokens,
      durationMs: llmCalls.durationMs,
      estCostUsd: llmCalls.estCostUsd,
    })
    .from(llmCalls)
    .where(gte(llmCalls.ts, new Date(Date.now() - days * DAY_MS)))
    .all();

  const byFeature = new Map<string, Accumulator>();
  for (const row of rows) {
    const acc = byFeature.get(row.feature) ?? newAccumulator();
    acc.calls += 1;
    acc.promptTokens += row.promptTokens;
    acc.completionTokens += row.completionTokens;
    acc.costUsd += row.estCostUsd;
    acc.durationMs += row.durationMs;
    byFeature.set(row.feature, acc);
  }
  return [...byFeature.entries()]
    .map(([feature, acc]) => ({ feature, ...finish(acc) }))
    .sort((a, b) => b.costUsd - a.costUsd || a.feature.localeCompare(b.feature));
}

export interface UserUsage {
  /** null = pipeline / anonymous (worker jobs, unauthenticated MCP calls). */
  userId: number | null;
  /** users.name; null for pipeline rows or a userId without a users row. */
  name: string | null;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  avgDurationMs: number;
}

/** Per-user aggregates over the trailing window (left join users for the name), most expensive first. */
export function llmUsageByUser(days = 30): UserUsage[] {
  const db = getDb();
  const rows = db
    .select({
      userId: llmCalls.userId,
      name: users.name,
      promptTokens: llmCalls.promptTokens,
      completionTokens: llmCalls.completionTokens,
      durationMs: llmCalls.durationMs,
      estCostUsd: llmCalls.estCostUsd,
    })
    .from(llmCalls)
    .leftJoin(users, eq(llmCalls.userId, users.id))
    .where(gte(llmCalls.ts, new Date(Date.now() - days * DAY_MS)))
    .all();

  const byUser = new Map<number | null, Accumulator & { name: string | null }>();
  for (const row of rows) {
    const acc = byUser.get(row.userId) ?? { ...newAccumulator(), name: row.name };
    acc.calls += 1;
    acc.promptTokens += row.promptTokens;
    acc.completionTokens += row.completionTokens;
    acc.costUsd += row.estCostUsd;
    acc.durationMs += row.durationMs;
    byUser.set(row.userId, acc);
  }
  return [...byUser.entries()]
    .map(([userId, acc]) => ({ userId, name: acc.name, ...finish(acc) }))
    .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);
}

export interface PlanCostStats {
  /** Metered calls with feature='plan' in the window. */
  calls: number;
  totalCostUsd: number;
  avgCostPerCallUsd: number | null;
  /** Estimated cost of one full plan generation (avg per call × CALLS_PER_PLAN). */
  avgCostPerPlanUsd: number | null;
}

/** Cost-per-plan card data: 'plan' + 'plan-phase' rows — count, total cost, avg per call and per generation. */
export function planCostStats(days = 30): PlanCostStats {
  const db = getDb();
  const rows = db
    .select({ estCostUsd: llmCalls.estCostUsd })
    .from(llmCalls)
    .where(and(inArray(llmCalls.feature, ['plan', 'plan-phase']), gte(llmCalls.ts, new Date(Date.now() - days * DAY_MS))))
    .all();
  const totalCostUsd = rows.reduce((a, r) => a + r.estCostUsd, 0);
  const avgCostPerCallUsd = rows.length === 0 ? null : totalCostUsd / rows.length;
  return {
    calls: rows.length,
    totalCostUsd,
    avgCostPerCallUsd,
    avgCostPerPlanUsd: avgCostPerCallUsd === null ? null : avgCostPerCallUsd * CALLS_PER_PLAN,
  };
}

export interface TierMargin {
  tier: Tier;
  /** Monthly subscription price from billing.ts TIER_PRICES. */
  priceUsd: number;
  quotaPlans: number;
  /** avgCostPerPlanUsd × quota; null until a plan generation is metered. */
  estMonthlyCostUsd: number | null;
  marginUsd: number | null;
  /** null for the free tier (no price to divide by) and when cost is unknown. */
  marginPct: number | null;
}

/** Margin view: monthly tier price vs measured avg plan cost × tier quota. */
export function marginByTier(avgCostPerPlanUsd: number | null): TierMargin[] {
  return (Object.keys(TIER_PRICES) as Tier[]).map((tier) => {
    const priceUsd = TIER_PRICES[tier];
    const quotaPlans = TIER_PLAN_QUOTAS[tier];
    const estMonthlyCostUsd = avgCostPerPlanUsd === null ? null : avgCostPerPlanUsd * quotaPlans;
    const marginUsd = estMonthlyCostUsd === null ? null : priceUsd - estMonthlyCostUsd;
    const marginPct = marginUsd === null || priceUsd === 0 ? null : (marginUsd / priceUsd) * 100;
    return { tier, priceUsd, quotaPlans, estMonthlyCostUsd, marginUsd, marginPct };
  });
}

export interface DivergencePoint {
  entity: string;
  value: number;
  date: string;
}

/**
 * Latest radar-score↔AA divergence points (§6e calibration). The science job
 * that writes them is parallel work — returns [] until the first nightly run.
 */
export function radarScoreDivergence(limit = 10): DivergencePoint[] {
  const db = getDb();
  return db
    .select({ entity: metricPoints.entity, value: metricPoints.value, date: metricPoints.date })
    .from(metricPoints)
    .where(and(eq(metricPoints.source, 'radar-score'), eq(metricPoints.metric, 'aa_divergence')))
    .orderBy(desc(metricPoints.date), desc(metricPoints.id))
    .limit(limit)
    .all();
}

export interface UsageReport {
  windowDays: number;
  totalCalls: number;
  totalCostUsd: number;
  daily: DailyCost[];
  byFeature: FeatureUsage[];
  byUser: UserUsage[];
  planCost: PlanCostStats;
  margins: TierMargin[];
  divergence: DivergencePoint[];
}

/** The full 7d/7e aggregate bundle — one call behind the /admin/usage page and the get_usage tool. */
export function usageReport(days = 30): UsageReport {
  const daily = dailyLlmCost(days);
  const planCost = planCostStats(days);
  return {
    windowDays: days,
    totalCalls: daily.reduce((a, d) => a + d.calls, 0),
    totalCostUsd: daily.reduce((a, d) => a + d.costUsd, 0),
    daily,
    byFeature: llmUsageByFeature(days),
    byUser: llmUsageByUser(days),
    planCost,
    margins: marginByTier(planCost.avgCostPerPlanUsd),
    divergence: radarScoreDivergence(),
  };
}
