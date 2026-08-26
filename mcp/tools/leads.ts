import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { opportunities } from '../../src/lib/db/schema';
import { composeLeads } from '../../src/lib/opportunities/compose';
import { getLead, insertLeads, markRefined, type Owner } from '../../src/lib/opportunities/leads';
import { persistScoutDrafts } from '../../src/lib/opportunities/persist-scout';
import { loadPrimitives } from '../../src/lib/opportunities/primitives';
import { refineLeads } from '../../src/lib/opportunities/refine';
import { dayKey } from '../../src/lib/opportunities/seed';
import { loadWedges } from '../../src/lib/opportunities/wedges';
import { getProfile } from '../../src/lib/personalization';
import { can } from '../../src/lib/entitlements';
import { envelopeSchema, respond, withUserEconomy, type NextAction } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

/** The pool identity for this caller. */
export function ownerFor(auth: AuthContext): Owner {
  return { ownerKey: auth.rateKey, userId: auth.userId };
}

const leadSchema = z.object({
  slug: z.string(),
  title: z.string(),
  thesis_skeleton: z.string(),
  sector: z.string().nullable(),
  wedge: z.record(z.string(), z.string()),
  evidence_refs: z.array(z.string()),
  heuristic_score: z.number(),
  stage: z.string(),
});

export function registerLeadTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'get_leads',
    {
      description:
        'Unlimited, free, instantly-generated business LEADS composed for you alone from the live intelligence stream crossed with a business-wedge taxonomy. Leads are UNVALIDATED hypotheses — they carry a heuristic score but deliberately no verdict, flip score or KPIs. Two callers never get the same leads, and paging with `cursor` keeps producing new ones until the space is exhausted. Costs no LLM budget. Call refine_lead to turn a promising one into a scored opportunity, or get_opportunities for the reviewed canonical radar.',
      inputSchema: {
        limit: z.number().int().min(1).max(25).default(8),
        cursor: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('position in YOUR combination space — pass next_cursor from a prior call'),
        sector: z.string().max(60).optional().describe('sector slug filter, e.g. devtools'),
      },
      outputSchema: {
        ...envelopeSchema,
        count: z.number(),
        leads: z.array(leadSchema),
        next_cursor: z.number().nullable(),
        space_size: z.number().describe('total combinations available to you'),
      },
    },
    async ({ limit, cursor, sector }) => {
      const owner = ownerFor(auth);
      const primitives = loadPrimitives();
      const space = loadWedges();

      // Builder+ personalization steers away from sectors the user rejected
      let avoidSectors: string[] = [];
      if (auth.userId != null && can({ id: auth.userId }, 'personalize').ok) {
        avoidSectors = getProfile(auth.userId)?.avoidedSectors ?? [];
      }

      const filtered = sector
        ? primitives.filter((p) => (p.sector ?? '').toLowerCase() === sector.toLowerCase())
        : primitives;

      const composed = composeLeads({
        primitives: filtered,
        space,
        ownerKey: owner.ownerKey,
        day: dayKey(),
        cursor: cursor ?? 0,
        limit,
        avoidSectors,
      });

      if (composed.leads.length === 0) {
        const reason =
          primitives.length === 0
            ? 'no demand signal in the last 21 days — pains come from Reddit/HN discussion, so check that those sources are ingesting'
            : composed.spaceSize === 0
              ? 'the wedge taxonomy is empty — run the seed script'
              : 'you have reached the end of your combination space for today';
        return respond(
          { count: 0, leads: [], next_cursor: null, space_size: composed.spaceSize },
          {
            summary: `No leads: ${reason}.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [
              {
                tool: 'get_opportunities',
                arguments: { limit: 10 },
                reason: 'the reviewed canonical radar costs nothing to browse',
              },
            ],
          },
        );
      }

      composed.leads.sort(
        (a, b) => b.heuristicScore - a.heuristicScore || a.slug.localeCompare(b.slug),
      );

      // persist so refine_lead can find them by slug later
      insertLeads(owner, composed.leads);

      const top = composed.leads[0];
      const next: NextAction[] = [
        {
          tool: 'refine_lead',
          arguments: { lead: top.slug },
          reason: 'score the strongest lead into a real opportunity with KPIs',
        },
      ];
      if (composed.nextCursor !== null) {
        next.push({
          tool: 'get_leads',
          arguments: { limit, cursor: composed.nextCursor },
          reason: 'more leads — your space is far from exhausted',
        });
      }

      return respond(
        {
          count: composed.leads.length,
          leads: composed.leads.map((l) => ({
            slug: l.slug,
            title: l.title,
            thesis_skeleton: l.thesisSkeleton,
            sector: l.sector,
            wedge: l.wedge,
            evidence_refs: l.primitiveRefs,
            heuristic_score: l.heuristicScore,
            stage: 'composed',
          })),
          next_cursor: composed.nextCursor,
          space_size: composed.spaceSize,
        },
        {
          summary: `${composed.leads.length} unvalidated leads composed for you (of ${composed.spaceSize.toLocaleString()} combinations) — strongest: "${top.title}" (heuristic ${top.heuristicScore}). Refine one to get real scores.`,
          economy: withUserEconomy(auth.userId, 'read'),
          next,
        },
      );
    },
  );

  server.registerTool(
    'refine_lead',
    {
      description:
        'Spend one LLM call to turn a composed lead into a real, scored opportunity: rewritten thesis, 10-axis sub-scores, KPIs, flip/hold scores and a verdict. The result is saved as YOUR private opportunity and is immediately usable with generate_plan. Requires sign-in and consumes your monthly refine quota. Get lead slugs from get_leads.',
      inputSchema: {
        lead: z.string().describe('lead slug from get_leads'),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        opportunity: z
          .object({
            slug: z.string(),
            title: z.string(),
            thesis: z.string(),
            flip_score: z.number(),
            hold_score: z.number(),
            verdict: z.string(),
            confidence: z.number(),
          })
          .optional(),
      },
    },
    async ({ lead }) => {
      if (auth.userId == null) {
        return respond(
          { ok: false, error: 'Refining a lead requires sign in — anonymous leads stay unvalidated.' },
          {
            summary: 'Sign in to refine leads into scored opportunities.',
            economy: withUserEconomy(auth.userId, 'read'),
            next: [
              { tool: 'get_leads', arguments: { limit: 10 }, reason: 'browsing leads stays free and unlimited' },
            ],
          },
        );
      }

      const gate = can({ id: auth.userId }, 'lead_refine');
      if (!gate.ok) {
        const hint = gate.upgradeHint ? ` — ${gate.upgradeHint}` : '';
        return respond(
          { ok: false, error: `${gate.reason ?? 'refine quota reached'}${hint}` },
          {
            summary: `Refine quota reached (${gate.used}/${gate.quota}, tier "${gate.tier}")${hint}.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [
              { tool: 'get_leads', arguments: { limit: 10 }, reason: 'leads remain free and unlimited' },
            ],
          },
        );
      }

      const owner = ownerFor(auth);
      const row = getLead(owner, lead);
      if (!row) {
        return respond(
          { ok: false, error: `No lead "${lead}" in your pool.` },
          {
            summary: `Lead "${lead}" is not in your pool.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'get_leads', arguments: { limit: 10 }, reason: 'list your current leads' }],
          },
        );
      }

      const drafts = await refineLeads({
        leads: [row],
        primitives: loadPrimitives(),
        userId: auth.userId,
      });
      if (drafts.length === 0) {
        return respond(
          { ok: false, error: 'The analyst rejected this lead as not genuinely actionable.' },
          {
            summary: `"${row.title}" did not survive refinement — that is an honest answer, not a failure.`,
            economy: withUserEconomy(auth.userId, 'scout'),
            next: [{ tool: 'get_leads', arguments: { limit: 10 }, reason: 'try a different angle' }],
          },
        );
      }

      const { persisted } = persistScoutDrafts(drafts, auth.userId);
      if (persisted[0]) markRefined(row.id, persisted[0].id);

      const db = getDb();
      const saved = db
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, persisted[0]!.id))
        .get()!;

      return respond(
        {
          ok: true,
          opportunity: {
            slug: saved.slug,
            title: saved.title,
            thesis: saved.thesis,
            flip_score: saved.flipScore,
            hold_score: saved.holdScore,
            verdict: saved.verdict,
            confidence: saved.confidence,
          },
        },
        {
          summary: `"${saved.title}" refined — flip ${saved.flipScore}/hold ${saved.holdScore}, verdict ${saved.verdict} (${saved.confidence}% confidence). Saved as your private opportunity.`,
          economy: withUserEconomy(auth.userId, 'scout'),
          next: [
            {
              tool: 'forge_opportunity',
              arguments: { opportunity: saved.slug },
              reason: 'adversarial deep pass before you commit real time',
            },
            {
              tool: 'generate_plan',
              arguments: { opportunity: saved.slug },
              reason: 'turn it into an executable plan',
            },
          ],
        },
      );
    },
  );
}
