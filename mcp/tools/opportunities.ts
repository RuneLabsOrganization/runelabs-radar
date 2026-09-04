import { and, desc, eq, gte, like, or } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { opportunities } from '../../src/lib/db/schema';
import { urls } from '../../src/lib/urls';
import { can } from '../../src/lib/entitlements';
import { fitBonus, getProfile, getSession, setSession } from '../../src/lib/personalization';
import { estimateTokens } from '../../src/lib/mcp-economy';
import { fnv1a } from '../../src/lib/hash';
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
import { marketVisible, hasScope, type AuthContext } from '../lib/auth';
import { visibleTo } from '../../src/lib/opportunities/scope';

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
//   → sector-quota page walk (limit-1 slots per page; overflow rows are
//     deferred to later pages, never dropped — the cursor is an offset into
//     this fully-paginated order, so paging cannot skip deferred rows)
//   → exploration slot fill (last slot of each page, quota-exempt)
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
  return fnv1a(`${rateKey}:${slug}`);
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

/**
 * Quota-walk `ranked` into pages of up to `limit` rows. Each page fills
 * limit-1 slots with at most SECTOR_QUOTA per sector, then one exploration
 * slot: the highest-ranked remainder row from a sector not on the page (the
 * one deliberate quota exception), else one from a sector whose quota is not
 * yet full. Rows that miss a page stay in the remainder for the next one —
 * paging to the end returns every ranked row exactly once, and a short page
 * is never padded from the next page (the per-response quota holds).
 */
function paginateRanked(ranked: OppRow[], limit: number): OppRow[][] {
  const normalSlots = Math.max(limit - 1, 0);
  const pages: OppRow[][] = [];
  let remaining = ranked.slice();
  while (remaining.length > 0) {
    const picked: OppRow[] = [];
    const rest: OppRow[] = [];
    const buckets = new Map<string | null, number>();
    for (const row of remaining) {
      const sec = row.sector ?? null;
      if (picked.length < normalSlots && (buckets.get(sec) ?? 0) < SECTOR_QUOTA) {
        picked.push(row);
        buckets.set(sec, (buckets.get(sec) ?? 0) + 1);
      } else {
        rest.push(row);
      }
    }
    if (picked.length < limit && rest.length > 0) {
      const present = new Set(picked.map((o) => o.sector ?? null));
      let idx = rest.findIndex((o) => !present.has(o.sector ?? null));
      if (idx < 0) idx = rest.findIndex((o) => (buckets.get(o.sector ?? null) ?? 0) < SECTOR_QUOTA);
      if (idx >= 0) picked.push(rest.splice(idx, 1)[0]!);
    }
    // Progress is guaranteed: with limit >= 2 the first row always fits its
    // bucket; with limit == 1 the exploration slot takes the first remainder
    // row (on an empty page every sector is absent). Guard anyway — a page
    // that emits nothing would loop forever.
    if (picked.length === 0) picked.push(rest.shift()!);
    pages.push(picked);
    remaining = rest;
  }
  return pages;
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
          .describe('offset into the ranked list — pass next_cursor from a prior call (same limit) for more'),
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
      if (!hasScope(auth, 'read')) {
        return respond(
          { count: 0, next_cursor: null, opportunities: [] },
          { summary: "This token has no 'read' scope — re-authorize with the read scope." },
        );
      }
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

      // Pages are built over the FULL ranked window; the cursor is the offset
      // at which the returned page starts. Quota-overflow rows deferred from
      // an earlier page head a later one instead of being skipped (previously
      // next_cursor resumed past their index). The page is exactly what the
      // quota walk emitted — never padded from the next page, so a short page
      // keeps its sector cap. Stable across calls with the same limit.
      const pages = paginateRanked(ranked, limit);
      let start = 0;
      let picked: OppRow[] = [];
      let nextCursor: number | null = null;
      for (const p of pages) {
        if (offset < start + p.length) {
          picked = p.slice(offset - start); // non-boundary cursor: resume within the page
          const end = start + p.length;
          nextCursor = end < ranked.length ? end : null;
          break;
        }
        start += p.length;
      }

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
                          arguments: {
                            limit,
                            cursor: nextCursor,
                            ...(sector ? { sector } : {}),
                            ...(verdict ? { verdict } : {}),
                            ...(min_flip !== undefined ? { min_flip } : {}),
                          },
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
      if (!hasScope(auth, 'read')) {
        return respond(
          { found: false },
          { summary: "This token has no 'read' scope — re-authorize with the read scope." },
        );
      }
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
