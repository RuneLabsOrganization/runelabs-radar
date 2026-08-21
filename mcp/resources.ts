import { desc, eq } from 'drizzle-orm';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../src/lib/db';
import { boardEntries, briefs, opportunities, stacks } from '../src/lib/db/schema';
import { topicHierarchy, topicHierarchyAsOf } from '../src/lib/analytics';
import { iso, parseJsonColumn } from './lib/payload';
import { marketVisible, type AuthContext } from './lib/auth';
import {
  AGENT_PERSONAS,
  AGENT_STACKS_REVIEWED_AT,
  DEFAULT_APP_STACK,
  HARNESS_LANDSCAPE,
  MODEL_PAIRINGS,
  costBand,
  landscapeWithMentions,
  resolvePersona,
} from '../src/lib/agent-stacks';

/**
 * radar:// resources — the browsable, addressable twin of the tool surface.
 * Static resources show up in resources/list; parameterized ones are
 * registered as templates (resources/templates/list).
 */

function jsonContents(uri: URL, data: unknown) {
  return {
    contents: [{ uri: uri.href, mimeType: 'application/json' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function markdownContents(uri: URL, markdown: string) {
  return { contents: [{ uri: uri.href, mimeType: 'text/markdown' as const, text: markdown }] };
}

function oppResource(o: typeof opportunities.$inferSelect) {
  return {
    slug: o.slug,
    title: o.title,
    thesis: o.thesis,
    sector: o.sector ?? null,
    status: o.status,
    window: o.window ?? null,
    flip_score: o.flipScore,
    hold_score: o.holdScore,
    verdict: o.verdict,
    confidence: o.confidence,
    sub_scores: parseJsonColumn<Record<string, number>>(o.scores, {}),
    kpis: parseJsonColumn<Record<string, unknown> | null>(o.kpis, null),
    has_brief: o.brief !== null,
    has_plan: o.plan !== null,
    first_seen: o.firstSeenAt.toISOString(),
    last_seen: o.lastSeenAt.toISOString(),
  };
}

export function registerResources(server: McpServer, auth: AuthContext): void {
  server.registerResource(
    'brief-latest',
    'radar://brief/latest',
    { description: 'The latest daily intelligence brief (markdown)', mimeType: 'text/markdown' },
    (uri) => {
      const row = getDb().select().from(briefs).orderBy(desc(briefs.date)).limit(1).get();
      return markdownContents(uri, row?.markdown ?? 'No brief published yet.');
    },
  );

  server.registerResource(
    'brief-by-date',
    new ResourceTemplate('radar://brief/{date}', { list: undefined }),
    { description: 'A daily brief by date (YYYY-MM-DD, markdown)', mimeType: 'text/markdown' },
    (uri, { date }) => {
      const row = getDb().select().from(briefs).where(eq(briefs.date, String(date))).get();
      return markdownContents(uri, row?.markdown ?? `No brief for ${String(date)}.`);
    },
  );

  server.registerResource(
    'board-domain',
    new ResourceTemplate('radar://board/{domain}', { list: undefined }),
    { description: 'Best-right-now board entries for one domain (coding, copy, image, video, ads, agentic)', mimeType: 'application/json' },
    (uri, { domain }) => {
      const rows = getDb()
        .select()
        .from(boardEntries)
        .where(eq(boardEntries.domain, String(domain)))
        .orderBy(boardEntries.task)
        .all();
      return jsonContents(uri, {
        domain: String(domain),
        board: rows.map((r) => ({
          task: r.task,
          best_overall: r.bestOverall ?? null,
          best_value: r.bestValue ?? null,
          cheapest_viable: r.cheapestViable ?? null,
          cost_note: r.costNote ?? null,
          verdict: r.runelabsVerdict ?? null,
          updated_at: iso(r.updatedAt),
        })),
      });
    },
  );

  server.registerResource(
    'stack-playbook',
    new ResourceTemplate('radar://stacks/{venture}', { list: undefined }),
    { description: 'Stack playbook for a venture type (e.g. saas-b2b, ai-product)', mimeType: 'application/json' },
    (uri, { venture }) => {
      const row = getDb().select().from(stacks).where(eq(stacks.venture, String(venture))).get();
      if (!row) return jsonContents(uri, { found: false, venture: String(venture) });
      return jsonContents(uri, {
        found: true,
        venture: row.venture,
        title: row.title,
        tagline: row.tagline ?? null,
        time_to_mvp: row.timeToMvp ?? null,
        run_cost: row.costNote ?? null,
        layers: parseJsonColumn(row.layers, []),
        rationale: row.rationale ?? null,
        updated_at: iso(row.updatedAt),
      });
    },
  );

  server.registerResource(
    'agent-stacks',
    'radar://agent-stacks',
    {
      description: 'Coding-agent stacks: IDE + harness + model by persona, survey love-rates, live 7-day mention heat',
      mimeType: 'application/json',
    },
    (uri) =>
      jsonContents(uri, {
        reviewed_at: AGENT_STACKS_REVIEWED_AT,
        personas: AGENT_PERSONAS.map((p) => ({
          slug: p.slug,
          label: p.label,
          stack: p.stack,
          cost: costBand(p),
        })),
        landscape: landscapeWithMentions(HARNESS_LANDSCAPE).map((h) => ({
          name: h.name,
          kind: h.kind,
          loved_pct: h.lovedPct,
          mentions_7d: h.mentions7d,
          role: h.role,
          loses: h.loses,
          sticker: h.sticker,
        })),
        pairings: MODEL_PAIRINGS,
        default_app_stack: DEFAULT_APP_STACK,
      }),
  );

  server.registerResource(
    'agent-stack-persona',
    new ResourceTemplate('radar://agent-stacks/{persona}', { list: undefined }),
    { description: 'One coding-agent stack playbook by persona slug (indie, daily, budget, power, nocoder, enterprise)', mimeType: 'application/json' },
    (uri, { persona }) => {
      const row = resolvePersona(String(persona));
      if (!row) return jsonContents(uri, { found: false, persona: String(persona) });
      return jsonContents(uri, {
        found: true,
        reviewed_at: AGENT_STACKS_REVIEWED_AT,
        slug: row.slug,
        label: row.label,
        stack: row.stack,
        ide: row.ide,
        harness: row.harness,
        model: row.model,
        cost: costBand(row),
        why: row.why,
        skip: row.skip,
      });
    },
  );

  server.registerResource(
    'opportunities',
    'radar://opportunities',
    { description: 'Active monetizable opportunities, flip-score ranked', mimeType: 'application/json' },
    (uri) => {
      const rows = getDb()
        .select()
        .from(opportunities)
        .where(eq(opportunities.status, 'active'))
        .orderBy(desc(opportunities.flipScore))
        .limit(25)
        .all();
      return jsonContents(uri, { count: rows.length, opportunities: rows.map(oppResource) });
    },
  );

  server.registerResource(
    'opportunity',
    new ResourceTemplate('radar://opportunity/{slug}', { list: undefined }),
    { description: 'One opportunity dossier by slug', mimeType: 'application/json' },
    (uri, { slug }) => {
      const row = getDb().select().from(opportunities).where(eq(opportunities.slug, String(slug))).get();
      return jsonContents(uri, row ? { found: true, opportunity: oppResource(row) } : { found: false });
    },
  );

  server.registerResource(
    'opportunity-plan',
    new ResourceTemplate('radar://plan/{slug}', { list: undefined }),
    {
      description: 'The cached execution plan for an opportunity (generate it first with the generate_plan tool)',
      mimeType: 'application/json',
    },
    (uri, { slug }) => {
      const row = getDb().select().from(opportunities).where(eq(opportunities.slug, String(slug))).get();
      if (!row) return jsonContents(uri, { found: false });
      const plan = parseJsonColumn<Record<string, unknown> | null>(row.plan, null);
      if (!plan) {
        return jsonContents(uri, {
          found: false,
          reason: 'no plan cached yet — call the generate_plan tool first',
        });
      }
      const grounding = Array.isArray(plan.grounding) ? plan.grounding : [];
      if (!marketVisible(auth) && grounding.some((g) => typeof g === 'string' && g.startsWith('model-market prices'))) {
        return jsonContents(uri, {
          found: false,
          reason: 'the cached plan is grounded in restricted market data (AA_PUBLIC=false for anonymous access)',
        });
      }
      return jsonContents(uri, { found: true, slug: row.slug, generated_at: iso(row.planGeneratedAt), plan });
    },
  );

  server.registerResource(
    'topic-map',
    'radar://map/latest',
    { description: 'Latest semantic topic map (macro clusters + subtopics, heat-scored)', mimeType: 'application/json' },
    (uri) => jsonContents(uri, { as_of: topicHierarchyAsOf(), topics: topicHierarchy() ?? [] }),
  );
}
