import { and, desc, eq, gte, like, or } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { opportunities } from '../../src/lib/db/schema';
import { config } from '../../src/lib/config';
import { envelopeSchema, iso, parseJsonColumn, respond, type NextAction } from '../lib/payload';
import { marketVisible, type AuthContext } from '../lib/auth';

type OppRow = typeof opportunities.$inferSelect;

function summary(o: OppRow) {
  return {
    slug: o.slug,
    title: o.title,
    sector: o.sector ?? null,
    window: o.window ?? null,
    flip_score: o.flipScore,
    hold_score: o.holdScore,
    verdict: o.verdict,
    confidence: o.confidence,
    thesis: o.thesis,
    has_brief: o.brief !== null,
    has_plan: o.plan !== null,
    first_seen: o.firstSeenAt.toISOString(),
    url: `${config.siteUrl}/opportunities`,
  };
}

/** Up to 3 slugs that fuzzily match a missed ref — turns a typo into a suggestion. */
function closestSlugs(ref: string): string[] {
  const db = getDb();
  const needle = `%${ref.toLowerCase().replace(/[%_]/g, '').slice(0, 40)}%`;
  if (needle === '%%') return [];
  return db
    .select({ slug: opportunities.slug })
    .from(opportunities)
    .where(or(like(opportunities.slug, needle), like(opportunities.title, needle)))
    .limit(3)
    .all()
    .map((r) => r.slug);
}

export function registerOpportunityTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'get_opportunities',
    {
      description:
        'Monetizable business openings detected from the intelligence stream (unmet pains, newly-cheap capability, launch gaps), flip/hold scored and adversarially reviewed. Use for "what should I build" questions. Call get_opportunity for the full dossier, generate_plan for an execution plan.',
      inputSchema: {
        limit: z.number().int().min(1).max(25).default(5),
        sector: z.string().optional().describe('sector slug filter, e.g. devtools, ai-coding'),
        verdict: z.enum(['pursue', 'watch', 'reject']).optional(),
        min_flip: z.number().int().min(0).max(100).optional().describe('minimum flip score'),
      },
      outputSchema: {
        ...envelopeSchema,
        count: z.number(),
        opportunities: z.array(
          z.object({
            slug: z.string(),
            title: z.string(),
            sector: z.string().nullable(),
            window: z.string().nullable(),
            flip_score: z.number(),
            hold_score: z.number(),
            verdict: z.string(),
            confidence: z.number(),
            thesis: z.string(),
            has_brief: z.boolean(),
            has_plan: z.boolean(),
            first_seen: z.string(),
            url: z.string(),
          }),
        ),
      },
    },
    async ({ limit, sector, verdict, min_flip }) => {
      const db = getDb();
      const conds = [eq(opportunities.status, 'active')];
      if (sector) conds.push(eq(opportunities.sector, sector));
      if (verdict) conds.push(eq(opportunities.verdict, verdict));
      if (min_flip !== undefined) conds.push(gte(opportunities.flipScore, min_flip));
      const rows = db
        .select()
        .from(opportunities)
        .where(and(...conds))
        .orderBy(desc(opportunities.flipScore))
        .limit(limit)
        .all();
      const top = rows[0];
      const filters = [sector && `sector=${sector}`, verdict && `verdict=${verdict}`, min_flip && `flip≥${min_flip}`]
        .filter(Boolean)
        .join(', ');
      return respond(
        { count: rows.length, opportunities: rows.map(summary) },
        {
          summary:
            rows.length === 0
              ? `No active opportunities${filters ? ` matching ${filters}` : ''}.`
              : `${rows.length} active opportunities${filters ? ` (${filters})` : ''} — top: "${top!.title}" (flip ${top!.flipScore}, ${top!.verdict}).`,
          next:
            rows.length === 0
              ? [{ tool: 'get_pain_points', arguments: { limit: 10 }, reason: 'raw unmet needs behind future openings' }]
              : [
                  {
                    tool: 'get_opportunity',
                    arguments: { opportunity: top!.slug },
                    reason: 'full dossier on the top opening',
                  },
                  {
                    tool: 'generate_plan',
                    arguments: { opportunity: top!.slug },
                    reason: 'turn it into an executable full-lifecycle plan',
                  },
                ],
        },
      );
    },
  );

  server.registerTool(
    'get_opportunity',
    {
      description:
        'The full dossier for one detected opportunity: sub-scores, hard KPIs (costs, break-even), evidence, the adversarial critic\'s review, and the cached launch brief. Identify by slug or id.',
      inputSchema: {
        opportunity: z.string().describe('opportunity slug (e.g. "bulk-bg-removal-api") or numeric id'),
      },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        suggestions: z.array(z.string()).optional(),
        opportunity: z
          .object({
            slug: z.string(),
            title: z.string(),
            thesis: z.string(),
            sector: z.string().nullable(),
            status: z.string(),
            window: z.string().nullable(),
            window_months: z.number().nullable(),
            flip_score: z.number(),
            hold_score: z.number(),
            verdict: z.string(),
            confidence: z.number(),
            sub_scores: z.record(z.string(), z.number()),
            kpis: z.record(z.string(), z.unknown()).nullable(),
            evidence: z.array(z.object({ type: z.string(), label: z.string() })),
            review: z.record(z.string(), z.unknown()).nullable(),
            brief: z.record(z.string(), z.unknown()).nullable(),
            has_plan: z.boolean(),
            first_seen: z.string(),
            last_seen: z.string(),
            reviewed_at: z.string().nullable(),
            url: z.string(),
          })
          .optional(),
      },
    },
    async ({ opportunity }) => {
      const db = getDb();
      const asId = /^\d+$/.test(opportunity) ? Number(opportunity) : null;
      const row = asId
        ? db.select().from(opportunities).where(eq(opportunities.id, asId)).get()
        : db.select().from(opportunities).where(eq(opportunities.slug, opportunity)).get();
      if (!row) {
        const suggestions = closestSlugs(opportunity);
        const next: NextAction[] = suggestions[0]
          ? [{ tool: 'get_opportunity', arguments: { opportunity: suggestions[0] }, reason: 'closest match' }]
          : [{ tool: 'get_opportunities', arguments: { limit: 10 }, reason: 'list valid slugs' }];
        return respond(
          { found: false, suggestions },
          {
            summary: `No opportunity "${opportunity}"${suggestions.length ? ` — closest: ${suggestions.join(', ')}` : ''}.`,
            next,
          },
        );
      }
      const brief = parseJsonColumn<Record<string, unknown> | null>(row.brief, null);
      if (brief && !marketVisible(auth)) {
        // AA redistribution terms: strip the model-price citations from unit
        // economics for restricted callers (same gate as get_market_models)
        const ue = brief.unitEconomics;
        if (ue && typeof ue === 'object') delete (ue as Record<string, unknown>).assumptions;
      }
      return respond(
        {
          found: true,
          opportunity: {
            slug: row.slug,
            title: row.title,
            thesis: row.thesis,
            sector: row.sector ?? null,
            status: row.status,
            window: row.window ?? null,
            window_months: row.windowMonths ?? null,
            flip_score: row.flipScore,
            hold_score: row.holdScore,
            verdict: row.verdict,
            confidence: row.confidence,
            sub_scores: parseJsonColumn<Record<string, number>>(row.scores, {}),
            kpis: parseJsonColumn<Record<string, unknown> | null>(row.kpis, null),
            evidence: parseJsonColumn<{ type: string; label: string }[]>(row.evidence, [])
              .filter((e) => e && typeof e.label === 'string')
              .map((e) => ({ type: String(e.type ?? 'note'), label: e.label })),
            review: parseJsonColumn<Record<string, unknown> | null>(row.review, null),
            brief,
            has_plan: row.plan !== null,
            first_seen: row.firstSeenAt.toISOString(),
            last_seen: row.lastSeenAt.toISOString(),
            reviewed_at: iso(row.reviewedAt),
            url: `${config.siteUrl}/opportunities`,
          },
        },
        {
          summary: `"${row.title}" — flip ${row.flipScore}/hold ${row.holdScore}, verdict ${row.verdict}, confidence ${row.confidence}%.${row.plan !== null ? ' Plan already generated.' : ''}`,
          next: [
            row.plan !== null
              ? {
                  tool: 'get_plan',
                  arguments: { opportunity: row.slug },
                  reason: 'the cached execution plan',
                }
              : {
                  tool: 'generate_plan',
                  arguments: { opportunity: row.slug },
                  reason: 'generate the executable full-lifecycle plan',
                },
            {
              tool: 'get_pain_points',
              arguments: { ...(row.sector ? { sector: row.sector } : {}), limit: 10 },
              reason: 'the demand evidence underneath',
            },
          ],
        },
      );
    },
  );
}
