import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { boardEntries, opportunities, painPoints, stories } from '../../src/lib/db/schema';
import { marketModels } from '../../src/lib/analytics';
import { DOMAINS } from '../../src/lib/domains';
import { setSession } from '../../src/lib/personalization';
import { urls } from '../../src/lib/urls';
import { envelopeSchema, respond, withUserEconomy } from '../lib/payload';
import { marketVisible, hasScope, type AuthContext } from '../lib/auth';
import { overlap, tokenSet } from '../lib/overlap';
import { visibleTo } from '../../src/lib/opportunities/scope';

export function registerJobTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'whats_relevant',
    {
      description:
        'Given what you are building, return the most relevant live signals, opportunities, pains, and board hints via token-overlap matching — no LLM. Prefer this over calling search + opportunities + pains separately.',
      inputSchema: {
        project: z.string().min(5).max(400).describe('what the user is building'),
      },
      outputSchema: {
        ...envelopeSchema,
        signals: z.array(
          z.object({
            id: z.number(),
            title: z.string(),
            score: z.number(),
            overlap: z.number(),
            url: z.string(),
          }),
        ),
        opportunities: z.array(
          z.object({
            slug: z.string(),
            title: z.string(),
            sector: z.string().nullable(),
            flip: z.number(),
            overlap: z.number(),
            url: z.string(),
          }),
        ),
        pains: z.array(
          z.object({
            summary: z.string(),
            sector: z.string().nullable(),
            intensity: z.number(),
            overlap: z.number(),
          }),
        ),
        board_hints: z.array(
          z.object({
            domain: z.string(),
            task: z.string(),
            best_overall: z.string().nullable(),
            overlap: z.number(),
          }),
        ),
      },
    },
    async ({ project }) => {
      if (!hasScope(auth, 'read')) {
        return respond(
          { signals: [], opportunities: [], pains: [], board_hints: [] },
          { summary: "This token has no 'read' scope — re-authorize with the read scope." },
        );
      }
      const db = getDb();
      const tok = tokenSet(project);

      const signalRows = db
        .select({ id: stories.id, title: stories.title, score: stories.topScore, tldr: stories.tldr })
        .from(stories)
        .where(eq(stories.status, 'curated'))
        .orderBy(desc(stories.topScore), desc(stories.createdAt))
        .limit(80)
        .all();
      const signals = signalRows
        .map((s) => ({
          id: s.id,
          title: s.title,
          score: s.score,
          overlap: overlap(tok, tokenSet(`${s.title} ${s.tldr ?? ''}`)),
          url: urls.story(s.id),
        }))
        .filter((x) => x.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap || b.score - a.score)
        .slice(0, 8);

      // Bounded scan, same rationale as get_opportunities: private Rung-1
      // rows share this table, so an unbounded .all() grows without limit.
      // Overlap matching re-sorts anyway — the top flip-ranked window is
      // plenty to find the relevant few.
      const RANK_WINDOW = 200;
      const oppRows = db
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.status, 'active'), visibleTo(auth.userId)))
        .orderBy(desc(opportunities.flipScore))
        .limit(RANK_WINDOW)
        .all();
      const opps = oppRows
        .map((o) => ({
          slug: o.slug,
          title: o.title,
          sector: o.sector ?? null,
          flip: o.flipScore,
          overlap: overlap(tok, tokenSet(`${o.title} ${o.thesis} ${o.sector ?? ''}`)),
          url: urls.opportunity(o.slug),
        }))
        .filter((x) => x.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap || b.flip - a.flip)
        .slice(0, 6);

      const painRows = db
        .select()
        .from(painPoints)
        .orderBy(desc(painPoints.intensity), desc(painPoints.lastSeenAt))
        .limit(60)
        .all();
      const pains = painRows
        .map((p) => ({
          summary: p.summary,
          sector: p.sector ?? null,
          intensity: p.intensity,
          overlap: overlap(tok, tokenSet(`${p.summary} ${p.sector ?? ''}`)),
        }))
        .filter((x) => x.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap || b.intensity - a.intensity)
        .slice(0, 6);

      const boardRows = db.select().from(boardEntries).all();
      const board_hints = boardRows
        .map((b) => ({
          domain: b.domain,
          task: b.task,
          best_overall: b.bestOverall ?? null,
          overlap: overlap(tok, tokenSet(`${b.domain} ${b.task} ${b.bestOverall ?? ''} ${b.runelabsVerdict ?? ''}`)),
        }))
        .filter((x) => x.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, 6);

      if (auth.userId != null) setSession(auth.userId, { lastProject: project });

      return respond(
        { signals, opportunities: opps, pains, board_hints },
        {
          summary:
            `Relevant to your project: ${signals.length} signals, ${opps.length} openings, ` +
            `${pains.length} pains, ${board_hints.length} board hints.`,
          economy: withUserEconomy(auth.userId, 'relevant'),
          next: opps[0]
            ? [
                {
                  tool: 'get_opportunity',
                  arguments: { opportunity: opps[0].slug, detail: 'compact' },
                  reason: `dossier on best-matching opening "${opps[0].slug}"`,
                },
                {
                  tool: 'ask_radar',
                  arguments: { question: `What should I prioritize for: ${project.slice(0, 200)}`, project },
                  reason: 'synthesis brief grounded in live intelligence',
                },
              ]
            : [{ tool: 'get_pain_points', arguments: { limit: 10 }, reason: 'browse unmet needs while openings catch up' }],
        },
      );
    },
  );

  server.registerTool(
    'decide',
    {
      description:
        'What should I use for this task? Returns matching board row(s), top market models (when visible), and a short template recommendation — replaces a multi-tool fetch quest. No LLM.',
      inputSchema: {
        task: z.string().min(2).max(200).describe('task to decide on, e.g. "code generation", "image edit"'),
        domain: z.enum(DOMAINS).optional().describe('optional domain filter'),
      },
      outputSchema: {
        ...envelopeSchema,
        board: z.array(
          z.object({
            domain: z.string(),
            task: z.string(),
            best_overall: z.string().nullable(),
            best_value: z.string().nullable(),
            cheapest_viable: z.string().nullable(),
            cost_note: z.string().nullable(),
            verdict: z.string().nullable(),
            overlap: z.number(),
          }),
        ),
        market_models: z
          .array(
            z.object({
              name: z.string(),
              intelligence: z.number(),
              price: z.number(),
              value: z.number(),
            }),
          )
          .optional(),
        recommendation: z.string(),
      },
    },
    async ({ task, domain }) => {
      if (!hasScope(auth, 'read')) {
        return respond(
          { board: [], recommendation: "This token has no 'read' scope — re-authorize with the read scope." },
          { summary: "This token has no 'read' scope — re-authorize with the read scope." },
        );
      }
      const db = getDb();
      const tok = tokenSet(task);
      let rows = db.select().from(boardEntries).all();
      if (domain) rows = rows.filter((r) => r.domain === domain);

      const scored = rows
        .map((b) => ({
          domain: b.domain,
          task: b.task,
          best_overall: b.bestOverall ?? null,
          best_value: b.bestValue ?? null,
          cheapest_viable: b.cheapestViable ?? null,
          cost_note: b.costNote ?? null,
          verdict: b.runelabsVerdict ?? null,
          overlap: Math.max(
            overlap(tok, tokenSet(b.task)),
            overlap(tok, tokenSet(`${b.domain} ${b.task}`)) * 0.9,
          ),
        }))
        .filter((x) => x.overlap > 0 || (!domain && rows.length <= 3))
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, 5);

      // if nothing overlapped, fall back to domain-filtered (or all) first few
      const board =
        scored.length > 0
          ? scored
          : rows.slice(0, 3).map((b) => ({
              domain: b.domain,
              task: b.task,
              best_overall: b.bestOverall ?? null,
              best_value: b.bestValue ?? null,
              cheapest_viable: b.cheapestViable ?? null,
              cost_note: b.costNote ?? null,
              verdict: b.runelabsVerdict ?? null,
              overlap: 0,
            }));

      let market_models: { name: string; intelligence: number; price: number; value: number }[] | undefined;
      if (marketVisible(auth)) {
        const market = marketModels();
        if (market) {
          market_models = market.models
            .filter((m) => m.intelligence >= 20 && m.price > 0)
            .sort((a, b) => b.intelligence / b.price - a.intelligence / a.price)
            .slice(0, 5)
            .map((m) => ({
              name: m.name,
              intelligence: m.intelligence,
              price: m.price,
              value: Math.round((m.intelligence / m.price) * 100) / 100,
            }));
        }
      }

      const top = board[0];
      const recommendation = top
        ? [
            `For "${task}"${domain ? ` (${domain})` : ''}, the board's closest row is [${top.domain}] ${top.task}.`,
            top.best_overall ? `Best overall: ${top.best_overall}.` : null,
            top.best_value ? `Best value: ${top.best_value}.` : null,
            top.cheapest_viable ? `Cheapest viable: ${top.cheapest_viable}.` : null,
            top.cost_note ? `Cost note: ${top.cost_note}.` : null,
            top.verdict ? `Verdict: ${top.verdict}.` : null,
            market_models?.[0]
              ? `Market value leader right now: ${market_models[0].name} (intel ${market_models[0].intelligence} @ $${market_models[0].price}/1M).`
              : null,
          ]
            .filter(Boolean)
            .join(' ')
        : `No board row matched "${task}". Browse get_best_right_now or narrow with a domain.`;

      return respond(
        { board, ...(market_models ? { market_models } : {}), recommendation },
        {
          summary: recommendation.slice(0, 200),
          economy: withUserEconomy(auth.userId, 'decide'),
          next: [
            {
              tool: 'get_best_right_now',
              arguments: domain ? { domain } : {},
              reason: 'full cost-benefit board for the domain',
            },
            ...(marketVisible(auth)
              ? [{ tool: 'get_market_models', arguments: { sort: 'value' }, reason: 'sanity-check picks against live prices' }]
              : []),
          ],
        },
      );
    },
  );
}
