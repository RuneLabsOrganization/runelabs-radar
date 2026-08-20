import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from './db';
import { llmCalls, planEntitlements } from './db/schema';

/**
 * Billing constants + quota logic (Phase 8). Artifact pricing: the user's
 * unit is a plan generation, not a token — per-call economics are enforced by
 * the Phase 7 observability built on llm_calls. Prices are placeholder
 * constants until Stripe checkout/webhooks land (8c). USD per month.
 */
export const TIER_PRICES = { free: 0, builder: 19, factory: 49 } as const;

export type Tier = keyof typeof TIER_PRICES;

/** Plans per month per tier (§1.4). */
const TIER_QUOTAS: Record<Tier, number> = { free: 3, builder: 30, factory: 100 };

/** Canonical tier → monthly plan quota. */
export function quotaFor(tier: Tier): number {
  return TIER_QUOTAS[tier];
}

/**
 * Start of the current billing cycle: the most recent day-`resetDay` at
 * 00:00 UTC. Clamp rule: resetDay is clamped to the length of the month in
 * question BEFORE comparing — resetDay 31 in a 30-day month resolves to the
 * 30th, in February to the 28th/29th. If today's clamped reset moment is
 * still in the future, the cycle started at last month's clamped reset
 * (December of the previous year when `now` is in January). All math is UTC
 * so quota windows never wobble with the server's local timezone.
 */
export function cycleStart(resetDay: number, now: Date = new Date()): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const candidate = clampedReset(y, m, resetDay);
  return candidate.getTime() <= now.getTime() ? candidate : clampedReset(y, m - 1, resetDay);
}

/** Day-`resetDay` of the given UTC month at 00:00 UTC, clamped to the month's last day. */
function clampedReset(year: number, month: number, resetDay: number): Date {
  // Date.UTC(y, m + 1, 0) is the last day of month m; m = -1 rolls to the
  // previous December, which is exactly what the year boundary needs
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(Math.trunc(resetDay), 1), lastDay);
  return new Date(Date.UTC(year, month, day));
}

/** Effective per-user plan entitlement. */
export interface Entitlement {
  tier: Tier;
  plansPerMonth: number;
  resetDay: number;
}

/** Read plan_entitlements; no row → free-tier defaults. */
export function entitlementFor(userId: number): Entitlement {
  const row = getDb().select().from(planEntitlements).where(eq(planEntitlements.userId, userId)).get();
  if (!row) return { tier: 'free', plansPerMonth: quotaFor('free'), resetDay: 1 };
  return { tier: row.tier, plansPerMonth: row.plansPerMonth, resetDay: row.resetDay };
}

/**
 * Plan-generation usage in the current billing cycle: llm_calls rows with
 * feature='plan' for this user at/after the cycle start. Cache hits write no
 * llm_calls rows, so they never consume quota.
 */
export function usageThisCycle(userId: number, now: Date = new Date()): number {
  const start = cycleStart(entitlementFor(userId).resetDay, now);
  const row = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(llmCalls)
    .where(and(eq(llmCalls.feature, 'plan'), eq(llmCalls.userId, userId), gte(llmCalls.ts, start)))
    .get();
  return row?.n ?? 0;
}

/** Quota gate verdict for plan generation. */
export interface PlanGate {
  ok: boolean;
  tier: Tier;
  used: number;
  quota: number;
}

/**
 * May this user generate a plan now? `quota` is the entitlement row's
 * plansPerMonth (per-user override); users without a row get the free quota.
 */
export function canGeneratePlan(userId: number, now: Date = new Date()): PlanGate {
  const ent = entitlementFor(userId);
  const used = usageThisCycle(userId, now);
  return { ok: used < ent.plansPerMonth, tier: ent.tier, used, quota: ent.plansPerMonth };
}
