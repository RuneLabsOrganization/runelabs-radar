import { and, desc, eq, gte, isNull, like, or } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { opportunities } from '../../src/lib/db/schema';
import { urls } from '../../src/lib/urls';
import { can } from '../../src/lib/entitlements';
import { fitBonus, getProfile, getSession, setSession } from '../../src/lib/personalization';
import { estimateTokens } from '../../src/lib/mcp-economy';
import {
  detailSchema,
  envelopeSchema,
  iso,
  parseJsonColumn,
  respond,
  withUserEconomy,
  type DetailLevel,
  type NextAction,
} from '../lib/payload';
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
    exploring_count: o.planRuns,
    verdict: o.verdict,
    confidence: o.confidence,
    thesis: o.thesis,
    has_brief: o.brief !== null,
    has_plan: o.plan !== null,
    first_seen: o.firstSeenAt.toISOString(),
    url: urls.opportunity(o.slug),
  };
}

function dossierCompact(row: OppRow, brief: Record<string, unknown> | null) {
  const review = parseJsonColumn<Record<string, unknown> | null>(row.review, null);
  return {
    slug: row.slug,
    title: row.title,
    thesis: row.thesis,
    sector: row.sector ?? null,
    window: row.window ?? null,
    flip_score: row.flipScore,
    hold_score: row.holdScore,
    exploring_count: row.planRuns,
    verdict: row.verdict,
    confidence: row.confidence,
    sub_scores: parseJsonColumn<Record<string, number>>(row.scores, {}),
    kpis: parseJsonColumn<Record<string, unknown> | null>(row.kpis, null),
    kill_risks: Array.isArray(review?.killRisks) ? (review!.killRisks as string[]) : [],
    has_plan: row.plan !== null,
    brief_icp: typeof brief?.icp === 'string' ? brief.icp : null,
    url: urls.opportunity(row.slug),
  };
}

function dossierSummary(row: OppRow) {
  return {
    slug: row.slug,
    title: row.title,
    flip_score: row.flipScore,
    hold_score: row.holdScore,
    verdict: row.verdict,
    confidence: row.confidence,
    has_plan: row.plan !== null,
    url: urls.opportunity(row.slug),
  };
}

/**
 * Rows this caller may see: the canonical public radar (owner NULL) plus
 * their own private openings. Anonymous callers get the public radar only —
 * their Rung-0 leads live in the `leads` table, not here.
 */
function visibleTo(userId: number | null) {
  return userId == null
    ? isNull(opportunities.ownerUserId)
    : or(isNull(opportunities.ownerUserId), eq(opportunities.ownerUserId, userId));
}

/** Up to 3 slugs that fuzzily match a missed ref — turns a typo into a suggestion. */
function closestSlugs(ref: string, userId: number | null): string[] {
  const db = getDb();
  const needle = `%${ref.toLowerCase().replace(/[%_]/g, '').slice(0, 40)}%`;
  if (needle === '%%') return [];
  return db
    .select({ slug: opportunities.slug })
    .from(opportunities)
    .where(
      and(
        or(like(opportunities.slug, needle), like(opportunities.title, needle)),
        visibleTo(userId),
      ),
    )
    .limit(3)
    .all()
    .map((r) => r.slug);
}

// --- anti-homogeneity (Phase 9d) + crowdedness (Phase 9e) -----------------
// Ordering pipeline for get_opportunities:
//   SQL filters (status/verdict/sector/min_flip)
//   → effectiveScore (crowdedness penalty — ordering only)
//   → per-caller salt within equal effective scores
//   → sector-quota walk (limit-1 slots)
//   → exploration slot fill (last slot, quota-exempt)
// Payloads always report the true flip_score; only ordering is jittered.

/** Max items per sector in one response; the null sector is its own bucket. */
const SECTOR_QUOTA = 2;

// An opportunity this many builders are already exploring (successful plan
// generations) is ordered CROWDED_PENALTY flip-points lower — the payload
// still reports the true flip_score.
const CROWDED_THRESHOLD = 3;
const CROWDED_PENALTY = 10;

function effectiveScore(o: OppRow, fit: number): number {
  return o.flipScore - (o.planRuns >= CROWDED_THRESHOLD ? CROWDED_PENALTY : 0) + fit;
}

/**
 * FNV-1a 32-bit over "<rateKey>:<slug>" — deterministic per (caller, item):
 * the same caller sees the same order all day; two callers the same morning
 * see different orders. Used only to break effective-score ties.
 */
function saltHash(rateKey: string, slug: string): number {
  let h = 0x811c9dc5;
  const s = `${rateKey}:${slug}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** effectiveScore desc, salt-hash asc within equal scores — a total order. */
function rankRows(rows: OppRow[], rateKey: string, fitFor: (o: OppRow) => number): OppRow[] {
  return rows
    .slice()
    .sort(
      (a, b) =>
        effectiveScore(b, fitFor(b)) - effectiveScore(a, fitFor(a)) ||
        saltHash(rateKey, a.slug) - saltHash(rateKey, b.slug),
    );
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
        cursor: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('offset into the ranked list — pass next_cursor from a prior call for more'),
      },
      outputSchema: {
        ...envelopeSchema,
        count: z.number(),
        next_cursor: z.number().nullable(),
        opportunities: z.array(
          z.object({
            slug: z.string(),
            title: z.string(),
            sector: z.string().nullable(),
            window: z.string().nullable(),
            flip_score: z.number(),
            hold_score: z.number(),
            exploring_count: z.number(),
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
    async ({ limit, sector, verdict, min_flip, cursor }) => {
      const db = getDb();
      const conds = [eq(opportunities.status, 'active'), visibleTo(auth.userId)];
      if (sector) conds.push(eq(opportunities.sector, sector));
      if (verdict) conds.push(eq(opportunities.verdict, verdict));
      if (min_flip !== undefined) conds.push(gte(opportunities.flipScore, min_flip));
      // Bounded scan. This table was once a small curated set, but private
      // Rung-1 rows now live here too, so an unbounded .all() would scan every
      // opening ever refined by this user. RANK_WINDOW is the widest slice the
      // quota walk can meaningfully reorder.
      const RANK_WINDOW = 200;
      const rows = db
        .select()
        .from(opportunities)
        .where(and(...conds))
        .orderBy(desc(opportunities.flipScore))
        .limit(RANK_WINDOW)
        .all();
      const personalize =
        auth.userId != null && can({ id: auth.userId }, 'personalize').ok
          ? { profile: getProfile(auth.userId), session: getSession(auth.userId) }
          : { profile: null, session: auth.userId != null ? getSession(auth.userId) : null };
      const fitFor = (o: OppRow) =>
        fitBonus(personalize.profile, personalize.session, {
          sector: o.sector,
          thesis: o.thesis,
          title: o.title,
          slug: o.slug,
        });
      const ranked = rankRows(rows, auth.rateKey, fitFor);
      const offset = cursor ?? 0;

      // sector-quota walk over the salted ranking: at most SECTOR_QUOTA per
      // sector, filling limit-1 slots. Stop once the page is full — do not
      // scan the rest of `ranked` just to populate overflow.
      const picked: OppRow[] = [];
      const rest: OppRow[] = [];
      const buckets = new Map<string | null, number>();
      const normalSlots = Math.max(limit - 1, 0);
      let i = offset;
      while (i < ranked.length && picked.length < normalSlots) {
        const row = ranked[i]!;
        const sec = row.sector ?? null;
        if ((buckets.get(sec) ?? 0) < SECTOR_QUOTA) {
          picked.push(row);
          buckets.set(sec, (buckets.get(sec) ?? 0) + 1);
        } else {
          rest.push(row);
        }
        i++;
      }

      // exploration slot: highest-ranked overflow item from a sector not yet
      // in the response — the one deliberate exception to the quota. When
      // every sector is already present (or nothing overflows), the last
      // slot just follows normal quota ranking.
      const present = new Set(picked.map((o) => o.sector ?? null));
      if (picked.length < limit) {
        const last =
          rest.find((o) => !present.has(o.sector ?? null)) ??
          rest.find((o) => (buckets.get(o.sector ?? null) ?? 0) < SECTOR_QUOTA);
        if (last) {
          picked.push(last);
        } else {
          while (i < ranked.length && picked.length < limit) {
            const row = ranked[i]!;
            const sec = row.sector ?? null;
            if (!present.has(sec) || (buckets.get(sec) ?? 0) < SECTOR_QUOTA) {
              picked.push(row);
              if ((buckets.get(sec) ?? 0) < SECTOR_QUOTA) {
                buckets.set(sec, (buckets.get(sec) ?? 0) + 1);
              }
              i++;
              break;
            }
            rest.push(row);
            i++;
          }
        }
      }

      // One past the farthest ranked index examined to fill this page.
      const nextCursor = i < ranked.length ? i : null;

      const top = picked[0];
      const filters = [sector && `sector=${sector}`, verdict && `verdict=${verdict}`, min_flip && `flip≥${min_flip}`]
        .filter(Boolean)
        .join(', ');
      return respond(
        { count: picked.length, opportunities: picked.map(summary), next_cursor: nextCursor },
        {
          summary:
            picked.length === 0
              ? `No active opportunities${filters ? ` matching ${filters}` : ''}.`
              : `${picked.length} active opportunities${filters ? ` (${filters})` : ''} — top: "${top!.title}" (flip ${top!.flipScore}, ${top!.verdict}).`,
          economy: withUserEconomy(auth.userId, 'read'),
          next:
            picked.length === 0
              ? [{ tool: 'get_pain_points', arguments: { limit: 10 }, reason: 'raw unmet needs behind future openings' }]
              : [
                  {
                    tool: 'get_opportunity',
                    arguments: { opportunity: top!.slug, detail: 'compact' },
                    reason: 'compact dossier on the top opening',
                  },
                  {
                    tool: 'generate_plan',
                    arguments: { opportunity: top!.slug },
                    reason: 'turn it into an executable full-lifecycle plan',
                  },
                  ...(nextCursor !== null
                    ? [
                        {
                          tool: 'get_opportunities',
                          arguments: { limit, cursor: nextCursor },
                          reason: 'next page of openings — the list continues',
                        },
                      ]
                    : []),
                ],
        },
      );
    },
  );

  server.registerTool(
    'get_opportunity',
    {
      description:
        'Dossier for one detected opportunity. Default detail=compact (scores, KPIs, kill risks). Pass detail=full for evidence, critic review, and launch brief.',
      inputSchema: {
        opportunity: z.string().describe('opportunity slug (e.g. "bulk-bg-removal-api") or numeric id'),
        detail: detailSchema,
      },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        detail: z.enum(['summary', 'compact', 'full']).optional(),
        suggestions: z.array(z.string()).optional(),
        opportunity: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ opportunity, detail }) => {
      const level = (detail ?? 'compact') as DetailLevel;
      const db = getDb();
      const asId = /^\d+$/.test(opportunity) ? Number(opportunity) : null;
      const row = asId
        ? db
            .select()
            .from(opportunities)
            .where(and(eq(opportunities.id, asId), visibleTo(auth.userId)))
            .get()
        : db
            .select()
            .from(opportunities)
            .where(and(eq(opportunities.slug, opportunity), visibleTo(auth.userId)))
            .orderBy(desc(opportunities.ownerUserId))
            .get();
      if (!row) {
        const suggestions = closestSlugs(opportunity, auth.userId);
        const next: NextAction[] = suggestions[0]
          ? [{ tool: 'get_opportunity', arguments: { opportunity: suggestions[0] }, reason: 'closest match' }]
          : [{ tool: 'get_opportunities', arguments: { limit: 10 }, reason: 'list valid slugs' }];
        return respond(
          { found: false, suggestions },
          {
            summary: `No opportunity "${opportunity}"${suggestions.length ? ` — closest: ${suggestions.join(', ')}` : ''}.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next,
          },
        );
      }
      if (auth.userId != null) {
        try {
          setSession(auth.userId, { lastOpportunity: row.slug });
        } catch {
          /* best-effort */
        }
      }
      const brief = parseJsonColumn<Record<string, unknown> | null>(row.brief, null);
      if (brief && !marketVisible(auth)) {
        const ue = brief.unitEconomics;
        if (ue && typeof ue === 'object') delete (ue as Record<string, unknown>).assumptions;
      }
      const fullOpp = {
        slug: row.slug,
        title: row.title,
        thesis: row.thesis,
        sector: row.sector ?? null,
        status: row.status,
        window: row.window ?? null,
        window_months: row.windowMonths ?? null,
        flip_score: row.flipScore,
        hold_score: row.holdScore,
        exploring_count: row.planRuns,
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
        url: urls.opportunity(row.slug),
      };
      const payload =
        level === 'summary'
          ? dossierSummary(row)
          : level === 'full'
            ? fullOpp
            : dossierCompact(row, brief);
      return respond(
        { found: true, detail: level, opportunity: payload },
        {
          summary: `"${row.title}" — flip ${row.flipScore}/hold ${row.holdScore}, verdict ${row.verdict}, confidence ${row.confidence}%.${row.plan !== null ? ' Plan already generated.' : ''}`,
          economy: withUserEconomy(auth.userId, 'dossier', {
            fullTokens: estimateTokens(JSON.stringify({ found: true, opportunity: fullOpp }, null, 2)),
          }),
          next: [
            row.plan !== null
              ? {
                  tool: 'get_plan',
                  arguments: { opportunity: row.slug, format: 'markdown' },
                  reason: 'the cached execution plan',
                }
              : {
                  tool: 'generate_plan',
                  arguments: { opportunity: row.slug },
                  reason: 'generate the executable full-lifecycle plan',
                },
            ...(level !== 'full'
              ? [
                  {
                    tool: 'get_opportunity',
                    arguments: { opportunity: row.slug, detail: 'full' },
                    reason: 'full dossier with evidence and brief',
                  },
                ]
              : []),
          ],
        },
      );
    },
  );
}
