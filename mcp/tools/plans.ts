import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { opportunities } from '../../src/lib/db/schema';
import { generatePlan, readPlan } from '../../src/lib/plans/generate';
import { planToWire, type ExecutionPlan } from '../../src/lib/plans/schema';
import { renderPlanMarkdown } from '../../src/lib/plans/markdown';
import { envelopeSchema, iso, respond, withUserEconomy } from '../lib/payload';
import { marketVisible, type AuthContext } from '../lib/auth';
import { can } from '../../src/lib/entitlements';
import { quotaFor, type Tier } from '../../src/lib/billing';
import { estimateTokens } from '../../src/lib/mcp-economy';
import { visibleTo } from '../../src/lib/opportunities/scope';

// --- plan-generation quotas (§8a): anonymous callers keep the flat per-caller
// daily cap (plans cost 6-7 LLM calls each, and the global MiniMax cap is
// shared with the curation worker); authed users are gated by their monthly
// plan entitlement (src/lib/billing.ts), metered from llm_calls rows ---
const PLAN_DAILY_CAP = Number(process.env.MCP_PLAN_DAILY_CAP ?? 10);
const planUsage = new Map<string, { date: string; count: number }>();
// in-flight generations count against the cap at ENTRY — otherwise N parallel
// calls all pass the check before any of them records (N× cap, N× LLM spend)
const planPending = new Map<string, number>();
function planCapExceeded(key: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const rec = planUsage.get(key);
  const used = (rec?.date === today ? rec.count : 0) + (planPending.get(key) ?? 0);
  return used >= PLAN_DAILY_CAP;
}
function markPlanPending(key: string): void {
  planPending.set(key, (planPending.get(key) ?? 0) + 1);
}
function clearPlanPending(key: string): void {
  const n = (planPending.get(key) ?? 1) - 1;
  if (n <= 0) planPending.delete(key);
  else planPending.set(key, n);
}
function recordPlanGeneration(key: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const rec = planUsage.get(key);
  planUsage.set(key, { date: today, count: (rec?.date === today ? rec.count : 0) + 1 });
}

/** A cached plan grounded in market prices is not servable to market-restricted callers. */
function includesMarket(plan: ExecutionPlan): boolean {
  return plan.grounding.some((g) => g.startsWith('model-market prices'));
}

const planSchema = z.object({
  version: z.number(),
  opportunity: z.string(),
  title: z.string(),
  overview: z.string(),
  icp: z.string(),
  pricing: z.object({ model: z.string(), price_usd: z.number().nullable(), notes: z.string() }),
  stack_venture: z.string().nullable(),
  total_estimate_hours: z.number().nullable(),
  phases: z.array(
    z.object({
      phase: z.string(),
      goal: z.string(),
      tasks: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          detail: z.string(),
          depends_on: z.array(z.string()),
          files_to_touch: z.array(z.string()),
          tools: z.array(z.string()),
          acceptance: z.array(z.string()),
          verify: z.string().nullable(),
          estimate_hours: z.number().nullable(),
          rollback: z.string().nullable(),
        }),
      ),
    }),
  ),
  grounding: z.array(z.string()),
  generated_at: z.string(),
});

function resolveOpportunity(ref: string, userId: number | null) {
  const db = getDb();
  const asId = /^\d+$/.test(ref) ? Number(ref) : null;
  return asId
    ? db.select().from(opportunities).where(and(eq(opportunities.id, asId), visibleTo(userId))).get()
    : db
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.slug, ref), visibleTo(userId)))
        .orderBy(desc(opportunities.ownerUserId))
        .get();
}

export function registerPlanTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'generate_plan',
    {
      description:
        'THE FLAGSHIP: turn a detected opportunity into a full-lifecycle execution plan (validation → build → launch → GTM → revenue) — a granular task graph with dependencies, files to touch, acceptance criteria, verification steps, time estimates and rollback notes, grounded in the platform\'s live data. Returns ONE format (default markdown for local execution). Cached per opportunity; force=true regenerates with the latest data. Generation takes ~30-100s (6-7 LLM calls) and emits progress notifications when the client sends a progressToken.',
      inputSchema: {
        opportunity: z.string().describe('opportunity slug (from get_opportunities) or numeric id'),
        force: z.boolean().default(false).describe('regenerate even when a cached plan exists'),
        format: z
          .enum(['markdown', 'json'])
          .default('markdown')
          .describe('return markdown (default, for PLAN.md) or json task graph — never both'),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        cached: z.boolean().optional(),
        format: z.enum(['markdown', 'json']).optional(),
        plan: planSchema.optional(),
        markdown: z.string().optional(),
      },
    },
    async ({ opportunity, force, format }, extra) => {
      if (!auth.scopes.has('plans')) {
        return respond(
          { ok: false, error: "this token lacks the 'plans' scope" },
          { summary: "This token has no 'plans' scope — re-authorize with the plans scope to generate plans." },
        );
      }
      const opp = resolveOpportunity(opportunity, auth.userId);
      if (!opp) {
        return respond(
          { ok: false, error: `no opportunity "${opportunity}" — see get_opportunities` },
          {
            summary: `No opportunity "${opportunity}".`,
            next: [{ tool: 'get_opportunities', arguments: { limit: 10 }, reason: 'list valid slugs' }],
          },
        );
      }
      if (auth.userId != null) {
        // authed: monthly entitlement quota. Usage comes from llm_calls rows
        // written by generation itself, so cache hits (no LLM rows) are free.
        // In-flight generations count at ENTRY, same rule as the daily cap.
        const gate = can({ id: auth.userId }, 'plan');
        const used = (gate.used ?? 0) + (planPending.get(auth.rateKey) ?? 0);
        if (!gate.ok || (gate.quota !== undefined && used >= gate.quota)) {
          const nextTier: Tier | null =
            gate.tier === 'free' ? 'builder' : gate.tier === 'builder' ? 'factory' : null;
          const hint = nextTier
            ? `upgrade to ${nextTier} for ${quotaFor(nextTier)} plans/mo — see /pricing`
            : 'see /pricing for higher-volume options';
          return respond(
            {
              ok: false,
              error: `monthly plan quota reached for tier "${gate.tier}" (${used}/${gate.quota ?? used} this cycle) — ${hint}`,
            },
            {
              summary: `Monthly plan quota reached (${used}/${gate.quota} this cycle, tier "${gate.tier}") — ${hint}.`,
              next: [
                {
                  tool: 'get_plan',
                  arguments: { opportunity: opp.slug },
                  reason: 'the cached plan, if one exists',
                },
              ],
            },
          );
        }
      } else if (planCapExceeded(auth.rateKey)) {
        return respond(
          {
            ok: false,
            error: `daily plan generation cap reached (${PLAN_DAILY_CAP}) — cached plans stay available via get_plan`,
          },
          {
            summary: `Daily plan generation cap reached (${PLAN_DAILY_CAP}).`,
            next: [
              {
                tool: 'get_plan',
                arguments: { opportunity: opp.slug },
                reason: 'the cached plan, if one exists',
              },
            ],
          },
        );
      }
      const canSeeMarket = marketVisible(auth);
      // stream MCP progress notifications when the client asked for them
      const progressToken = extra._meta?.progressToken;
      const onProgress =
        progressToken === undefined
          ? undefined
          : (done: number, total: number, label: string) => {
              void extra
                .sendNotification({
                  method: 'notifications/progress',
                  params: { progressToken, progress: done, total, message: label },
                })
                .catch(() => {});
            };
      markPlanPending(auth.rateKey);
      try {
        const result = await generatePlan(opp.id, {
          force,
          includeMarket: canSeeMarket,
          onProgress,
          userId: auth.userId,
        });
        if (!result.ok) {
          return respond({ ok: false, error: result.error }, { summary: `Plan generation failed: ${result.error}` });
        }
        if (!canSeeMarket && includesMarket(result.plan)) {
          // refusal BEFORE recording: a refused caller must not burn a cap slot
          return respond(
            {
              ok: false,
              error:
                'the cached plan is grounded in restricted market data (AA_PUBLIC=false for anonymous access) — call again with force=true to generate a shareable plan without it',
            },
            { summary: 'The cached plan contains restricted market data and cannot be served to this caller.' },
          );
        }
        // authed usage is already metered in llm_calls by generation itself;
        // only the anonymous flat cap needs the in-memory tally
        if (!result.cached && auth.userId == null) recordPlanGeneration(auth.rateKey);
        const p = result.plan;
        const wire = planToWire(p);
        const md = renderPlanMarkdown(p);
        const dualTokens = estimateTokens(JSON.stringify({ plan: wire, markdown: md }, null, 2));
        const outFormat = format ?? 'markdown';
        return respond(
          {
            ok: true,
            cached: result.cached,
            format: outFormat,
            ...(outFormat === 'json' ? { plan: wire } : { markdown: md }),
          },
          {
            summary: `${result.cached ? 'Cached' : 'New'} plan "${p.title}" — ${p.phases.length} phases, ${p.phases.reduce((n, x) => n + x.tasks.length, 0)} tasks${p.totalEstimateHours !== null ? `, ~${p.totalEstimateHours}h total` : ''} (${outFormat}).`,
            economy: withUserEconomy(auth.userId, 'plan', { fullTokens: dualTokens }),
            next: [
              outFormat === 'markdown'
                ? {
                    tool: 'get_plan',
                    arguments: { opportunity: p.opportunity, format: 'json' },
                    reason: 'the task graph JSON if you need machine-readable dependencies',
                  }
                : {
                    tool: 'get_plan',
                    arguments: { opportunity: p.opportunity, format: 'markdown' },
                    reason: 'the document rendering to save as PLAN.md and execute',
                  },
            ],
          },
        );
      } finally {
        clearPlanPending(auth.rateKey);
      }
    },
  );

  server.registerTool(
    'get_plan',
    {
      description:
        'Fetch the cached execution plan for an opportunity (no generation — call generate_plan first). Format "json" for the task graph, "markdown" for the document.',
      inputSchema: {
        opportunity: z.string().describe('opportunity slug or numeric id'),
        format: z.enum(['json', 'markdown']).default('json'),
      },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        reason: z.string().optional(),
        slug: z.string().optional(),
        generated_at: z.string().nullable().optional(),
        plan: planSchema.optional(),
        markdown: z.string().optional(),
      },
    },
    async ({ opportunity, format }) => {
      const opp = resolveOpportunity(opportunity, auth.userId);
      if (!opp) {
        return respond(
          { found: false, reason: `no opportunity "${opportunity}"` },
          {
            summary: `No opportunity "${opportunity}".`,
            next: [{ tool: 'get_opportunities', arguments: { limit: 10 }, reason: 'list valid slugs' }],
          },
        );
      }
      const plan = readPlan(opp.id, auth.userId);
      if (!plan) {
        return respond(
          {
            found: false,
            slug: opp.slug,
            reason: 'no plan cached yet — call generate_plan for this opportunity first',
          },
          {
            summary: `No plan cached for "${opp.title}" yet.`,
            next: [
              {
                tool: 'generate_plan',
                arguments: { opportunity: opp.slug },
                reason: 'generate it (takes ~30-100s, emits progress)',
              },
            ],
          },
        );
      }
      if (!marketVisible(auth) && includesMarket(plan)) {
        return respond(
          {
            found: false,
            slug: opp.slug,
            reason:
              'the cached plan is grounded in restricted market data (AA_PUBLIC=false for anonymous access) — regenerate with generate_plan force=true to produce a shareable plan',
          },
          { summary: 'The cached plan contains restricted market data and cannot be served to this caller.' },
        );
      }
      const wire = planToWire(plan);
      return respond(
        {
          found: true,
          slug: opp.slug,
          generated_at: iso(opp.planGeneratedAt),
          ...(format === 'markdown' ? { markdown: renderPlanMarkdown(plan) } : { plan: wire }),
        },
        {
          summary: `Plan "${plan.title}" (${format}) — generated ${plan.generatedAt.slice(0, 10)}.`,
          next: [
            {
              tool: 'get_opportunity',
              arguments: { opportunity: opp.slug },
              reason: 'the dossier behind the plan',
            },
          ],
        },
      );
    },
  );
}
