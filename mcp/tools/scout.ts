import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { opportunities } from '../../src/lib/db/schema';
import { normalizeSlug, type OppDraft, type ScoutConstraints } from '../../src/lib/opportunities/engine';
import { composeLeads } from '../../src/lib/opportunities/compose';
import { dismissedSlugs, insertLeads } from '../../src/lib/opportunities/leads';
import { persistScoutDrafts } from '../../src/lib/opportunities/persist-scout';
import { loadPrimitives } from '../../src/lib/opportunities/primitives';
import { refineLeads } from '../../src/lib/opportunities/refine';
import { publicOnly } from '../../src/lib/opportunities/scope';
import { dayKey } from '../../src/lib/opportunities/seed';
import { loadWedges } from '../../src/lib/opportunities/wedges';
import { getProfile } from '../../src/lib/personalization';
import { can } from '../../src/lib/entitlements';
import { bump, peek } from '../../src/lib/usage/counters';
import { envelopeSchema, respond, withUserEconomy, type NextAction } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

// Per-caller daily cap for anonymous callers: every scout run is a fresh LLM
// call, so every call counts. Signed-in callers go through entitlements
// instead (can(user, 'scout')). Persisted, so a deploy no longer grants
// everyone a fresh allowance.
const SCOUT_DAILY_CAP = Number(process.env.MCP_SCOUT_DAILY_CAP ?? 10);

function scoutCapExceeded(key: string): boolean {
  return peek(key, 'scout', 'day') >= SCOUT_DAILY_CAP;
}

function recordScout(key: string): void {
  bump(key, 'scout', 'day');
}

const kpiSchema = z.object({
  initialCostUsd: z.number().nullable(),
  monthlyCostUsd: z.number().nullable(),
  priceUsd: z.number().nullable(),
  timeToMvpDays: z.number().nullable(),
  breakEvenCustomers: z.number().nullable(),
  competitorCount: z.number().nullable(),
  competitionNote: z.string().nullable(),
  regulatoryNote: z.string().nullable(),
});

const openingSchema = z.object({
  slug: z.string(),
  title: z.string(),
  thesis: z.string(),
  sector: z.string().nullable(),
  window: z.string().nullable(),
  sub_scores: z.record(z.string(), z.number()),
  kpis: kpiSchema,
  evidence_refs: z.array(z.string()),
  persisted: z.boolean().optional(),
});

/** Active opportunity slugs visible to this caller, normalized as the engine keys them. */
function activeSlugs(userId: number | null): Set<string> {
  const db = getDb();
  // Only the caller's own openings suppress a draft. Another builder having
  // already been shown this idea is not a reason to withhold it — that is the
  // bug that made scout return nothing once the shared pool saturated.
  const where =
    userId == null
      ? and(eq(opportunities.status, 'active'), publicOnly())
      : and(eq(opportunities.status, 'active'), eq(opportunities.ownerUserId, userId));
  return new Set(
    db.select({ slug: opportunities.slug }).from(opportunities).where(where).all()
      .map((r) => normalizeSlug(r.slug)),
  );
}

export function registerScoutTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'scout_opportunities',
    {
      description:
        'Scout FRESH monetizable openings fitted to you — your skills, capital, hours, sector and risk appetite — instead of the global top-5 everyone else sees. Runs the opportunity proposer seeded with your constraints over the current intelligence stream (pains, launches, market, surging entities, top stories), then drops anything already tracked as an active opportunity so what comes back is personal and new. Pressure-test a pick with debate_idea afterwards. Returns zero openings (honestly) when nothing is genuinely actionable.',
      inputSchema: {
        skills: z.string().max(400).optional().describe('what you can build with, e.g. "typescript, next.js, some python"'),
        capital: z.string().max(120).optional().describe('budget band, e.g. "<$500", "$2k runway"'),
        hoursPerWeek: z.number().int().min(0).max(80).optional().describe('hours per week you can put in'),
        sector: z.string().max(60).optional().describe('sector focus, e.g. devtools, ai-coding'),
        b2b: z.boolean().optional().describe('true for B2B openings, false for B2C'),
        riskAppetite: z.enum(['low', 'medium', 'high']).optional(),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        openings: z.array(openingSchema),
        skipped_existing: z.number(),
      },
    },
    async ({ skills, capital, hoursPerWeek, sector, b2b, riskAppetite }) => {
      if (auth.userId != null) {
        const gate = can({ id: auth.userId }, 'scout');
        if (!gate.ok) {
          const hint = gate.upgradeHint ? ` — ${gate.upgradeHint}` : '';
          return respond(
            {
              ok: false,
              error: gate.reason ?? `scout quota reached (${gate.used}/${gate.quota})${hint}`,
              openings: [],
              skipped_existing: 0,
            },
            {
              summary: `Scout quota reached (${gate.used}/${gate.quota}, tier "${gate.tier}")${hint}.`,
              economy: withUserEconomy(auth.userId, 'scout'),
              next: [
                {
                  tool: 'get_opportunities',
                  arguments: { limit: 10 },
                  reason: 'the tracked openings cost nothing to browse',
                },
              ],
            },
          );
        }
      } else if (scoutCapExceeded(auth.rateKey)) {
        return respond(
          { ok: false, error: `daily scout cap reached (${SCOUT_DAILY_CAP}) — the cap resets tomorrow`, openings: [], skipped_existing: 0 },
          {
            summary: `Daily scout cap reached (${SCOUT_DAILY_CAP}).`,
            economy: withUserEconomy(auth.userId, 'scout'),
            next: [
              {
                tool: 'get_opportunities',
                arguments: { limit: 10 },
                reason: 'the tracked openings cost nothing to browse',
              },
            ],
          },
        );
      }
      // every call counts — record at entry, before the LLM run (anonymous daily cap)
      if (auth.userId == null) recordScout(auth.rateKey);

      // Prefer explicit args; fall back to saved profile for Builder+ personalize
      let profileSkills = skills;
      let profileSector = sector;
      let profileCapital = capital;
      if (auth.userId != null && can({ id: auth.userId }, 'personalize').ok) {
        const profile = getProfile(auth.userId);
        if (profile) {
          if (!profileSkills && profile.skills.length) profileSkills = profile.skills.join(', ');
          if (!profileSector && profile.interests[0]) profileSector = profile.interests[0];
          if (!profileCapital && profile.capitalBand) profileCapital = profile.capitalBand;
        }
      }

      const constraints: ScoutConstraints = {
        ...(profileSkills !== undefined ? { skills: profileSkills } : {}),
        ...(profileCapital !== undefined ? { capital: profileCapital } : {}),
        ...(hoursPerWeek !== undefined ? { hoursPerWeek } : {}),
        ...(profileSector !== undefined ? { sector: profileSector } : {}),
        ...(b2b !== undefined ? { b2b } : {}),
        ...(riskAppetite !== undefined ? { riskAppetite } : {}),
      };
      const hasConstraints = Object.keys(constraints).length > 0;

      let drafts: OppDraft[];
      let signalCount: number;
      try {
        const primitives = loadPrimitives();
        signalCount = primitives.length;
        if (signalCount >= 5) {
          const owner = { ownerKey: auth.rateKey, userId: auth.userId };
          const composed = composeLeads({
            primitives,
            space: loadWedges(),
            ownerKey: owner.ownerKey,
            day: dayKey(),
            cursor: 0,
            limit: 8,
            excludeSlugs: dismissedSlugs(owner),
          });
          const stored = insertLeads(owner, composed.leads);
          ({ drafts } = await refineLeads({
            leads: stored,
            primitives,
            ...(hasConstraints ? { constraints } : {}),
            userId: auth.userId,
            feature: 'scout',
          }));
        } else {
          drafts = [];
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return respond(
          { ok: false, error: `scout failed: ${msg}`, openings: [], skipped_existing: 0 },
          { summary: `The scout could not run: ${msg}.` },
        );
      }

      if (signalCount < 5) {
        return respond(
          {
            ok: false,
            error: `the scope is too thin to scout (${signalCount} signals in the last 2 weeks; need at least 5) — let the daily ingest accumulate and try again`,
            openings: [],
            skipped_existing: 0,
          },
          {
            summary: `Scope too thin to scout — only ${signalCount} signals on the radar right now.`,
            next: [
              {
                tool: 'get_pain_points',
                arguments: { limit: 10 },
                reason: 'browse the raw unmet needs collected so far',
              },
            ],
          },
        );
      }

      // anti-homogeneity: these must be FRESH personal openings — drop any
      // draft whose slug is already tracked as an active opportunity
      const existing = activeSlugs(auth.userId);
      const fresh = drafts.filter((d) => !existing.has(normalizeSlug(d.slug)));
      const skipped = drafts.length - fresh.length;

      // Persist so generate_plan works immediately (no wait for daily engine)
      const { persisted } = persistScoutDrafts(fresh, auth.userId);
      const persistedSlugs = new Set(persisted.map((p) => p.slug));

      const openings = fresh.map((d) => ({
        slug: d.slug,
        title: d.title,
        thesis: d.thesis,
        sector: d.sector,
        window: d.window,
        sub_scores: d.sub,
        kpis: d.kpis,
        evidence_refs: d.evidenceRefs,
        persisted: persistedSlugs.has(normalizeSlug(d.slug)),
      }));

      const top = openings[0];
      const next: NextAction[] = [];
      if (top) {
        next.push({
          tool: 'debate_idea',
          arguments: { idea: `${top.title} — ${top.thesis}` },
          reason: 'pressure-test the top opening in a multi-role debate before committing',
        });
        if (persisted.length > 0) {
          next.push({
            tool: 'generate_plan',
            arguments: { opportunity: top.slug },
            reason: 'execution plan — openings from this scout are persisted and plan-ready',
          });
        }
      } else if (skipped > 0) {
        next.push({
          tool: 'get_opportunities',
          arguments: { limit: 10 },
          reason: 'everything proposed is already tracked — browse those openings here',
        });
      }

      const summary =
        openings.length === 0
          ? skipped > 0
            ? `The scout proposed ${skipped} opening${skipped === 1 ? '' : 's'}, but every one is already tracked as an active opportunity — nothing fresh for these constraints right now.`
            : 'The scout found nothing genuinely actionable for these constraints — zero is an acceptable answer.'
          : `${openings.length} fresh opening${openings.length === 1 ? '' : 's'} fitted to your constraints — top: "${top!.title}"${top!.sector ? ` (${top!.sector})` : ''}${skipped > 0 ? `; ${skipped} skipped (already tracked)` : ''}; ${persisted.filter((p) => p.created).length} newly persisted for generate_plan.`;

      return respond(
        { ok: true, openings, skipped_existing: skipped },
        { summary, economy: withUserEconomy(auth.userId, 'scout'), next },
      );
    },
  );
}
