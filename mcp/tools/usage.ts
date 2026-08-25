import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { users } from '../../src/lib/db/schema';
import { usageReport } from '../../src/lib/usage';
import { can, TIER_CAPS } from '../../src/lib/entitlements';
import { entitlementFor, usageThisCycle } from '../../src/lib/billing';
import { economyThisCycle, economyLifetimeSaved } from '../../src/lib/mcp-economy';
import { envelopeSchema, respond, withUserEconomy } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

/** Round to 6 decimals — costs are tiny (a plan call ≈ $0.0001); keeps the payload clean. */
function r6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function r6n(n: number | null): number | null {
  return n === null ? null : r6(n);
}

/** Admin gate: the token's userId must map to a users row with role='admin'. */
function isAdmin(auth: AuthContext): boolean {
  if (auth.userId === null) return false;
  const db = getDb();
  const row = db.select({ role: users.role }).from(users).where(eq(users.id, auth.userId)).get();
  return row?.role === 'admin';
}

const daySchema = z.object({
  date: z.string(),
  calls: z.number().int(),
  est_cost_usd: z.number(),
});

const featureSchema = z.object({
  feature: z.string(),
  calls: z.number().int(),
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
  est_cost_usd: z.number(),
  avg_duration_ms: z.number().int(),
});

const userSchema = z.object({
  user_id: z.number().int().nullable(),
  name: z.string().nullable(),
  calls: z.number().int(),
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
  est_cost_usd: z.number(),
  avg_duration_ms: z.number().int(),
});

const marginSchema = z.object({
  tier: z.string(),
  price_usd: z.number(),
  quota_plans: z.number().int(),
  est_monthly_cost_usd: z.number().nullable(),
  margin_usd: z.number().nullable(),
  margin_pct: z.number().nullable(),
});

export function registerUsageTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'get_usage',
    {
      description:
        'ADMIN-ONLY: LLM usage and cost aggregates from metered calls — daily cost series, per-feature and per-user breakdowns, plan-generation unit cost, and tier margin estimates. Restricted to hub admin accounts; any other caller gets a polite refusal.',
      inputSchema: {
        days: z.number().int().min(1).max(90).default(30).describe('lookback window in days'),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        window_days: z.number().optional(),
        total_calls: z.number().optional(),
        total_est_cost_usd: z.number().optional(),
        daily: z.array(daySchema).optional(),
        by_feature: z.array(featureSchema).optional(),
        by_user: z.array(userSchema).optional(),
        plan_cost: z
          .object({
            plan_calls: z.number().int(),
            total_est_cost_usd: z.number(),
            avg_cost_per_call_usd: z.number().nullable(),
            avg_cost_per_plan_usd: z.number().nullable(),
          })
          .optional(),
        margins: z.array(marginSchema).optional(),
      },
    },
    async ({ days }) => {
      if (!isAdmin(auth)) {
        return respond(
          { ok: false, error: 'admin-only: get_usage is restricted to hub admin accounts' },
          {
            summary:
              'get_usage is admin-only — per-feature cost and margin data is operator surface, not public data.',
          },
        );
      }
      const report = usageReport(days);
      const data = {
        ok: true,
        window_days: report.windowDays,
        total_calls: report.totalCalls,
        total_est_cost_usd: r6(report.totalCostUsd),
        daily: report.daily.map((d) => ({ date: d.date, calls: d.calls, est_cost_usd: r6(d.costUsd) })),
        by_feature: report.byFeature.map((f) => ({
          feature: f.feature,
          calls: f.calls,
          prompt_tokens: f.promptTokens,
          completion_tokens: f.completionTokens,
          est_cost_usd: r6(f.costUsd),
          avg_duration_ms: f.avgDurationMs,
        })),
        by_user: report.byUser.map((u) => ({
          user_id: u.userId,
          name: u.name,
          calls: u.calls,
          prompt_tokens: u.promptTokens,
          completion_tokens: u.completionTokens,
          est_cost_usd: r6(u.costUsd),
          avg_duration_ms: u.avgDurationMs,
        })),
        plan_cost: {
          plan_calls: report.planCost.calls,
          total_est_cost_usd: r6(report.planCost.totalCostUsd),
          avg_cost_per_call_usd: r6n(report.planCost.avgCostPerCallUsd),
          avg_cost_per_plan_usd: r6n(report.planCost.avgCostPerPlanUsd),
        },
        margins: report.margins.map((m) => ({
          tier: m.tier,
          price_usd: m.priceUsd,
          quota_plans: m.quotaPlans,
          est_monthly_cost_usd: r6n(m.estMonthlyCostUsd),
          margin_usd: r6n(m.marginUsd),
          margin_pct: m.marginPct === null ? null : Math.round(m.marginPct * 10) / 10,
        })),
      };
      const builder = report.margins.find((m) => m.tier === 'builder');
      return respond(data, {
        summary:
          report.totalCalls === 0
            ? `No metered LLM calls in the last ${days}d — llm_calls rows land on every chatJSON call.`
            : `Last ${days}d: ${report.totalCalls} metered calls, $${r6(report.totalCostUsd)} est — ${report.byFeature.length} features, ${report.byUser.length} user buckets` +
              (report.planCost.avgCostPerPlanUsd !== null && builder?.marginPct != null
                ? `; avg plan ≈ $${r6(report.planCost.avgCostPerPlanUsd)}, builder margin ≈ ${Math.round(builder.marginPct)}%.`
                : '.'),
      });
    },
  );

  server.registerTool(
    'get_my_usage',
    {
      description:
        'Your membership quota and token-savings receipt for this billing cycle: plans/debates/asks remaining, plus how many tokens Radar kept out of your coding agent\'s context. Not admin — any authenticated caller.',
      inputSchema: {},
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        tier: z.string().optional(),
        cycle_key: z.string().optional(),
        plans: z.object({ used: z.number(), quota: z.number() }).optional(),
        debates: z.object({ used: z.number().nullable(), quota: z.number().nullable() }).optional(),
        asks: z.object({ used: z.number().nullable(), quota: z.number().nullable() }).optional(),
        scouts: z.object({ used: z.number().nullable(), quota: z.number().nullable() }).optional(),
        savings: z
          .object({
            calls: z.number(),
            tokens_returned: z.number(),
            tokens_saved_vs_full: z.number(),
            tokens_saved_vs_diy: z.number(),
            lifetime_saved_vs_diy: z.number(),
          })
          .optional(),
      },
    },
    async () => {
      if (auth.userId == null) {
        return respond(
          { ok: false, error: 'sign in required — get_my_usage needs an authenticated MCP session' },
          {
            summary: 'Sign in to see your quota and token-savings receipt.',
            economy: withUserEconomy(null, 'read'),
          },
        );
      }
      const user = { id: auth.userId };
      const ent = entitlementFor(auth.userId);
      const caps = TIER_CAPS[ent.tier];
      const planGate = can(user, 'plan');
      const debateGate = can(user, 'debate');
      const askGate = can(user, 'ask');
      const scoutGate = can(user, 'scout');
      const eco = economyThisCycle(auth.userId);
      const lifetime = economyLifetimeSaved(auth.userId);
      const plansUsed = usageThisCycle(auth.userId);
      return respond(
        {
          ok: true,
          tier: ent.tier,
          cycle_key: eco.cycle_key,
          plans: { used: plansUsed, quota: ent.plansPerMonth || caps.plansPerMonth },
          debates: {
            used: debateGate.used ?? null,
            quota: caps.debatesPerMonth < 0 ? null : (debateGate.quota ?? caps.debatesPerMonth),
          },
          asks: {
            used: askGate.used ?? null,
            quota: caps.asksPerMonth < 0 ? null : (askGate.quota ?? caps.asksPerMonth),
          },
          scouts: {
            used: scoutGate.used ?? null,
            quota: ent.tier === 'free' ? (scoutGate.quota ?? 3) : null,
          },
          savings: {
            calls: eco.calls,
            tokens_returned: eco.tokens_returned,
            tokens_saved_vs_full: eco.tokens_saved_vs_full,
            tokens_saved_vs_diy: eco.tokens_saved_vs_diy,
            lifetime_saved_vs_diy: lifetime,
          },
        },
        {
          summary: `Tier ${ent.tier}: ${plansUsed}/${ent.plansPerMonth} plans this cycle; Radar saved ~${eco.tokens_saved_vs_diy.toLocaleString()} DIY tokens so far this cycle.`,
          economy: withUserEconomy(auth.userId, 'read'),
          next: [
            { tool: 'ask_radar', arguments: { question: 'What should I build this week?' }, reason: 'spend Radar tokens, not yours' },
            { tool: 'get_opportunities', arguments: { limit: 5 }, reason: 'browse openings (free)' },
          ],
        },
      );
    },
  );
}
