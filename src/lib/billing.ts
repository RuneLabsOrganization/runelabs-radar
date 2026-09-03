import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from './db';
import { llmCalls, planEntitlements } from './db/schema';
import { quotaFor, type Tier } from './billing-prices';

export { TIER_PRICES, TIER_PRICES_ANNUAL, quotaFor, type Tier } from './billing-prices';

/**
 * Billing quota logic (Phase 8). Artifact pricing: the user's unit is a plan
 * generation, not a token — per-call economics are enforced by the Phase 7
 * observability built on llm_calls. List prices live in billing-prices.ts
 * (client-safe); Stripe checkout/webhooks are part of this go-live.
 */

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
 * Effective monthly plan quota: an explicit per-user override always wins —
 * including 0, an admin-set zero-quota must block rather than fall through to
 * the tier cap. Null/undefined means "no override" → the tier cap. The single
 * source every plan gate (canGeneratePlan, entitlements.can, admission) uses,
 * so the gates can never disagree.
 */
export function planQuota(ent: { tier: Tier; plansPerMonth: number | null }): number {
  return ent.plansPerMonth ?? quotaFor(ent.tier);
}

/**
 * Plan-generation usage in the current billing cycle: llm_calls rows with
 * feature='plan' for this user at/after the cycle start. Cache hits write no
 * llm_calls rows, so they never consume quota. Generations that fail midway
 * are compensated by generate.ts (their frame row is re-tagged
 * feature='plan-failed'), so a failed attempt does not burn quota either.
 * Admission rows (model='plan-admission', billing.admitPlanGeneration) count
 * while in flight and are released by generate.ts once the generation
 * resolves — cache hit, success, or failure.
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
 * May this user generate a plan now? Read-only gate — same quota rule as
 * entitlements.can(user, 'plan') via planQuota: a per-user override wins
 * (0 blocks), otherwise the tier cap. Callers that need to RESERVE a slot
 * against concurrent requests should use admitPlanGeneration instead.
 */
export function canGeneratePlan(userId: number, now: Date = new Date()): PlanGate {
  const ent = entitlementFor(userId);
  const used = usageThisCycle(userId, now);
  const quota = planQuota(ent);
  return { ok: used < quota, tier: ent.tier, used, quota };
}

/** PlanGate plus the admission row id holding the reserved slot (null when rejected). */
export interface PlanAdmission extends PlanGate {
  admissionId: number | null;
}

/**
 * Atomic plan-generation admission: the quota check AND the slot-reserving
 * llm_calls insert in one synchronous critical section. better-sqlite3 is
 * synchronous, so nothing can interleave between the count and the insert
 * in-process — two concurrent callers can no longer both pass a quota of 1.
 * The admission row is a real feature='plan' row (usageThisCycle counts it
 * immediately); generate.ts swaps it for the frame's metered row once the
 * frame call lands, and releases it on cache hits and failed generations.
 *
 * Residual: count and insert are two statements, so across two PROCESSES a
 * microsecond window remains where both read the pre-insert count — SQLite
 * offers no conditional insert through drizzle's better-sqlite3 driver. The
 * per-process planPending map in mcp/tools/plans.ts stays as best-effort
 * cover for that window.
 */
export function admitPlanGeneration(userId: number, now: Date = new Date()): PlanAdmission {
  const ent = entitlementFor(userId);
  const quota = planQuota(ent);
  const used = usageThisCycle(userId, now);
  if (used >= quota) return { ok: false, tier: ent.tier, used, quota, admissionId: null };
  const row = getDb()
    .insert(llmCalls)
    .values({ ts: now, feature: 'plan', userId, model: 'plan-admission' })
    .returning({ id: llmCalls.id })
    .get();
  return { ok: true, tier: ent.tier, used, quota, admissionId: row?.id ?? null };
}
