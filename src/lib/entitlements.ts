/**
 * Unified capability matrix — consumed by the web app AND MCP tools.
 * Reads stay free/unlimited. Generative and personalized actions are gated.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from './db';
import { batches, llmCalls, planEntitlements } from './db/schema';
import { cycleStart, entitlementFor, quotaFor, type Tier, TIER_PRICES } from './billing';

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

const TIER_CAPS: Record<
  Tier,
  {
    plansPerMonth: number;
    debatesPerMonth: number;
    asksPerMonth: number; // -1 = unlimited; ask_radar synthesis
    workspaceBatches: number; // -1 = unlimited
    batchRuns: boolean;
    personalize: boolean;
    leadRefinesPerMonth: number; // -1 = unlimited; Rung 1
    forgesPerMonth: number; // 0 = unavailable; Rung 2 (4 llm calls each)
  }
> = {
  free: {
    plansPerMonth: 3,
    debatesPerMonth: 3,
    asksPerMonth: 10,
    workspaceBatches: 1,
    batchRuns: false,
    personalize: false,
    leadRefinesPerMonth: 3,
    forgesPerMonth: 0,
  },
  builder: {
    plansPerMonth: 30,
    debatesPerMonth: -1,
    asksPerMonth: 100,
    workspaceBatches: 10,
    batchRuns: true,
    personalize: true,
    leadRefinesPerMonth: 50,
    forgesPerMonth: 5,
  },
  factory: {
    plansPerMonth: 100,
    debatesPerMonth: -1,
    asksPerMonth: -1,
    workspaceBatches: -1,
    batchRuns: true,
    personalize: true,
    leadRefinesPerMonth: -1,
    forgesPerMonth: 30,
  },
};

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
  // 4 llm_calls (feature='debate') per debate generation
  return Math.floor(countFeature(userId, 'debate', resetDay, now) / 4);
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
      const quota = ent.plansPerMonth || caps.plansPerMonth;
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
      const used = Math.floor(countFeature(user.id, 'forge', ent.resetDay, now) / 4);
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

export { TIER_PRICES, TIER_CAPS, quotaFor, entitlementFor, type Tier };
