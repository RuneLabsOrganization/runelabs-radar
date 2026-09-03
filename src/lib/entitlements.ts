/**
 * Unified capability matrix — consumed by the web app AND MCP tools.
 * Reads stay free/unlimited. Generative and personalized actions are gated.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from './db';
import { batches, llmCalls, planEntitlements } from './db/schema';
import { cycleStart, entitlementFor, planQuota, quotaFor, type Tier, TIER_PRICES } from './billing';
import { TIER_CAPS } from './entitlements-caps';

export type Capability =
  | 'vote'
  | 'verdict'
  | 'debate'
  | 'plan'
  | 'scout'
  | 'ask'
  | 'batch_create'
  | 'batch_run'
  | 'personalize'
  | 'lead_refine'
  | 'forge';

export interface EntitlementUser {
  id: number;
  tier?: Tier;
}

export interface GateResult {
  ok: boolean;
  tier: Tier;
  reason?: string;
  used?: number;
  quota?: number;
  upgradeHint?: string;
}

function tierFor(user: EntitlementUser | null | undefined): Tier {
  if (!user) return 'free';
  if (user.tier) return user.tier;
  return entitlementFor(user.id).tier;
}

function countFeature(userId: number, feature: string, resetDay: number, now = new Date()): number {
  const start = cycleStart(resetDay, now);
  const row = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(llmCalls)
    .where(and(eq(llmCalls.feature, feature), eq(llmCalls.userId, userId), gte(llmCalls.ts, start)))
    .get();
  return row?.n ?? 0;
}

function countWorkspaceBatches(userId: number): number {
  const row = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(batches)
    .where(and(eq(batches.ownerId, userId), eq(batches.kind, 'workspace')))
    .get();
  return row?.n ?? 0;
}

function countDebates(userId: number, resetDay: number, now = new Date()): number {
  return countCompleteQuartets(userId, 'debate', resetDay, now);
}

/**
 * Debates and forges meter 4 llm_calls rows per generation (one per role), so
 * the quota unit is a complete quartet. Chosen behavior for FAILED partial
 * generations: their leftover rows are indistinguishable from complete ones
 * at the llm_calls level (rows carry no run id), and Math.floor only counts
 * full groups of 4 — a lone partial quartet is dropped, but leftovers from
 * several failed generations can still combine into a phantom counted unit
 * (one per 4 leftover rows). A precise fix needs write-time tagging in the
 * debate/forge generators (mcp/tools), the way plans re-tag 'plan-failed';
 * until then this over-counts failures, never under-counts completed runs.
 */
function countCompleteQuartets(userId: number, feature: string, resetDay: number, now = new Date()): number {
  return Math.floor(countFeature(userId, feature, resetDay, now) / 4);
}

export function can(user: EntitlementUser | null | undefined, capability: Capability, now = new Date()): GateResult {
  if (!user) {
    return {
      ok: false,
      tier: 'free',
      reason: 'Sign in to use this action.',
      upgradeHint: 'Create a free account to unlock votes, debates, and plans.',
    };
  }

  const ent = entitlementFor(user.id);
  const tier = ent.tier;
  const caps = TIER_CAPS[tier];

  switch (capability) {
    case 'vote':
    case 'verdict':
      return { ok: true, tier };

    case 'personalize':
      return caps.personalize
        ? { ok: true, tier }
        : { ok: false, tier, reason: 'Personalization requires Builder.', upgradeHint: 'Upgrade to Builder.' };

    case 'batch_run':
      return caps.batchRuns
        ? { ok: true, tier }
        : { ok: false, tier, reason: 'Bulk batch runs require Builder.', upgradeHint: 'Upgrade to Builder for bulk debate/plan runs.' };

    case 'batch_create': {
      if (caps.workspaceBatches < 0) return { ok: true, tier };
      const used = countWorkspaceBatches(user.id);
      return used < caps.workspaceBatches
        ? { ok: true, tier, used, quota: caps.workspaceBatches }
        : {
            ok: false,
            tier,
            used,
            quota: caps.workspaceBatches,
            reason: `Workspace batch limit reached (${used}/${caps.workspaceBatches}).`,
            upgradeHint: 'Upgrade for more batches.',
          };
    }

    case 'plan': {
      const used = countFeature(user.id, 'plan', ent.resetDay, now);
      const quota = planQuota(ent);
      return used < quota
        ? { ok: true, tier, used, quota }
        : {
            ok: false,
            tier,
            used,
            quota,
            reason: `Plan quota reached (${used}/${quota} this cycle).`,
            upgradeHint: tier === 'factory' ? 'Quota resets next cycle.' : 'Upgrade for a higher plan quota.',
          };
    }

    case 'debate': {
      if (caps.debatesPerMonth < 0) return { ok: true, tier };
      const used = countDebates(user.id, ent.resetDay, now);
      return used < caps.debatesPerMonth
        ? { ok: true, tier, used, quota: caps.debatesPerMonth }
        : {
            ok: false,
            tier,
            used,
            quota: caps.debatesPerMonth,
            reason: `Debate quota reached (${used}/${caps.debatesPerMonth}).`,
            upgradeHint: 'Upgrade to Builder for unlimited debates.',
          };
    }

    case 'scout': {
      // Scout shares debate-like generative budget on free; unlimited on paid
      if (tier !== 'free') return { ok: true, tier };
      const used = countFeature(user.id, 'scout', ent.resetDay, now);
      const quota = 3;
      return used < quota
        ? { ok: true, tier, used, quota }
        : { ok: false, tier, used, quota, reason: 'Scout quota reached.', upgradeHint: 'Upgrade to Builder.' };
    }

    case 'ask': {
      if (caps.asksPerMonth < 0) return { ok: true, tier };
      const used = countFeature(user.id, 'ask', ent.resetDay, now);
      return used < caps.asksPerMonth
        ? { ok: true, tier, used, quota: caps.asksPerMonth }
        : {
            ok: false,
            tier,
            used,
            quota: caps.asksPerMonth,
            reason: `ask_radar quota reached (${used}/${caps.asksPerMonth}).`,
            upgradeHint: tier === 'factory' ? 'Quota resets next cycle.' : 'Upgrade for more synthesis asks.',
          };
    }

    case 'lead_refine': {
      if (caps.leadRefinesPerMonth < 0) return { ok: true, tier };
      const used = countFeature(user.id, 'lead_refine', ent.resetDay, now);
      const quota = caps.leadRefinesPerMonth;
      return used < quota
        ? { ok: true, tier, used, quota }
        : {
            ok: false, tier, used, quota,
            reason: `Refine quota reached (${used}/${quota} this cycle).`,
            upgradeHint:
              tier === 'factory'
                ? 'Quota resets next cycle.'
                : 'Upgrade for more refines — composed leads stay free and unlimited.',
          };
    }

    case 'forge': {
      const quota = caps.forgesPerMonth;
      if (quota === 0) {
        return {
          ok: false, tier, used: 0, quota,
          reason: 'The adversarial deep pass requires Builder.',
          upgradeHint: 'Upgrade to Builder to forge openings before you commit.',
        };
      }
      // 4 llm_calls (feature='forge') per forge, same accounting as debates
      const used = countCompleteQuartets(user.id, 'forge', ent.resetDay, now);
      return used < quota
        ? { ok: true, tier, used, quota }
        : {
            ok: false, tier, used, quota,
            reason: `Forge quota reached (${used}/${quota} this cycle).`,
            upgradeHint: tier === 'factory' ? 'Quota resets next cycle.' : 'Upgrade for more forges.',
          };
    }

    default:
      return { ok: false, tier, reason: 'Unknown capability.' };
  }
}

export { TIER_CAPS } from './entitlements-caps';
export { TIER_PRICES, quotaFor, entitlementFor, type Tier };
