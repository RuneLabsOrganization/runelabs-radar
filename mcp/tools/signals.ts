import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { items, sources, stories } from '../../src/lib/db/schema';
import { config } from '../../src/lib/config';
import { DOMAINS } from '../../src/lib/domains';
import { envelopeSchema, hoursAgo, parseJsonColumn, respond } from '../lib/payload';

const domainEnum = z.enum(DOMAINS).optional();

const signalSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  score: z.number(),
  tldr: z.string().nullable(),
  why_it_matters: z.string().nullable(),
  created_at: z.string(),
  url: z.string(),
});

type StoryRow = typeof stories.$inferSelect;

function toSignal(s: StoryRow, score: number) {
  return {
    id: s.id,
    title: s.title,
    score,
    tldr: s.tldr ?? null,
    why_it_matters: s.whyItMatters ?? null,
    created_at: s.createdAt.toISOString(),
    url: `${config.siteUrl}/story/${s.id}`,
  };
}

/** Turn free text into a safe FTS5 query: quoted terms OR'd together. */
function ftsQuery(raw: string): string | null {
  const terms = raw
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter((t) => t.length > 1)
    .slice(0, 8);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"`).join(' OR ');
}

export function registerSignalTools(server: McpServer): void {
  server.registerTool(
    'get_top_signals',
    {
      description:
        'Top curated AI stories on the scope right now, scored 0-100 per domain (coding, copy, image, video, ads, agentic). Use for "what happened in AI today/this week" questions.',
      inputSchema: {
        domain: domainEnum.describe('filter to a domain'),
        limit: z.number().int().min(1).max(25).default(10),
        hours: z.number().int().min(1).max(720).default(72).describe('lookback window'),
      },
      outputSchema: {
        ...envelopeSchema,
        window_hours: z.number(),
        domain: z.string(),
        count: z.number(),
        signals: z.array(signalSchema),
      },
    },
    async ({ domain, limit, hours }) => {
      const db = getDb();
      const rows = db
        .select()
        .from(stories)
        .where(and(eq(stories.status, 'curated'), gt(stories.createdAt, hoursAgo(hours))))
        .orderBy(desc(stories.topScore))
        .limit(200)
        .all();
      const filtered = rows
        .map((s) => ({ s, scores: parseJsonColumn<Record<string, number>>(s.domainScores, {}) }))
        .filter((x) => !domain || (x.scores[domain] ?? 0) >= 40)
        .slice(0, limit)
        .map(({ s, scores }) => toSignal(s, domain ? (scores[domain] ?? 0) : s.topScore));
      const top = filtered[0];
      return respond(
        { window_hours: hours, domain: domain ?? 'all', count: filtered.length, signals: filtered },
        {
          summary:
            filtered.length === 0
              ? `No curated signals in the last ${hours}h${domain ? ` for ${domain}` : ''}.`
              : `${filtered.length} ${domain ?? 'cross-domain'} signals in the last ${hours}h — top: "${top!.title}" (${top!.score}).`,
          next: top
            ? [
                {
                  tool: 'get_story',
                  arguments: { id: top.id },
                  reason: 'full detail, sources and second-look on the top signal',
                },
                {
                  tool: 'get_daily_brief',
                  arguments: {},
                  reason: 'the editorial synthesis of these signals',
                },
              ]
            : [{ tool: 'get_daily_brief', arguments: {}, reason: 'catch up via the daily brief instead' }],
        },
      );
    },
  );

  server.registerTool(
    'search_stories',
    {
      description:
        'Full-text search over every curated story (title, summary, why-it-matters). Use to find past coverage of a model, company, or technique.',
      inputSchema: {
        query: z.string().min(2).max(200),
        limit: z.number().int().min(1).max(25).default(10),
        days: z.number().int().min(1).max(365).default(90).describe('only stories from the last N days'),
      },
      outputSchema: {
        ...envelopeSchema,
        query: z.string(),
        count: z.number(),
        results: z.array(signalSchema),
      },
    },
    async ({ query, limit, days }) => {
      const match = ftsQuery(query);
      if (!match) {
        return respond(
          { query, count: 0, results: [] },
          { summary: `Query "${query}" has no usable search terms.` },
        );
      }
      const db = getDb();
      // raw SQL note: drizzle stores mode:'timestamp' columns as epoch SECONDS
      const cutoffS = Math.floor((Date.now() - days * 864e5) / 1000);
      const rows = db.all<{
        id: number;
        title: string;
        tldr: string | null;
        why_it_matters: string | null;
        top_score: number;
        created_at: number;
      }>(sql`
        SELECT s.id, s.title, s.tldr, s.why_it_matters, s.top_score, s.created_at
        FROM stories_fts JOIN stories s ON s.id = stories_fts.rowid
        WHERE stories_fts MATCH ${match} AND s.status = 'curated' AND s.created_at >= ${cutoffS}
        ORDER BY rank
        LIMIT ${limit}`);
      const results = rows.map((r) => ({
        id: r.id,
        title: r.title,
        score: r.top_score,
        tldr: r.tldr,
        why_it_matters: r.why_it_matters,
        created_at: new Date(r.created_at * 1000).toISOString(),
        url: `${config.siteUrl}/story/${r.id}`,
      }));
      const top = results[0];
      return respond(
        { query, count: results.length, results },
        {
          summary:
            results.length === 0
              ? `No curated stories matching "${query}" in the last ${days} days.`
              : `${results.length} stories match "${query}" — best: "${top!.title}" (${top!.score}).`,
          next:
            results.length === 0
              ? [{ tool: 'get_top_signals', arguments: { limit: 10 }, reason: 'browse what is on the scope instead' }]
              : [
                  {
                    tool: 'get_story',
                    arguments: { id: top!.id },
                    reason: 'read the best match in full',
                  },
                  {
                    tool: 'get_entity',
                    arguments: { name: query },
                    reason: 'if this is a model/tool/org, get its tracked profile',
                  },
                ],
        },
      );
    },
  );

  server.registerTool(
    'get_story',
    {
      description:
        'Full detail for one story: summary, why it matters, domain scores, the contrarian second look, hindsight grade, and original source links.',
      inputSchema: { id: z.number().int().describe('story id from get_top_signals / search_stories') },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        story: z
          .object({
            id: z.number().int(),
            title: z.string(),
            tldr: z.string().nullable(),
            why_it_matters: z.string().nullable(),
            top_score: z.number(),
            domain_scores: z.record(z.string(), z.number()),
            entities: z.array(z.object({ name: z.string(), kind: z.string() })),
            second_look: z.string().nullable(),
            hindsight: z.number().nullable(),
            created_at: z.string(),
            updated_at: z.string().nullable(),
            url: z.string(),
            sources: z.array(
              z.object({
                source: z.string(),
                title: z.string(),
                url: z.string(),
                published_at: z.string().nullable(),
              }),
            ),
          })
          .optional(),
      },
    },
    async ({ id }) => {
      const db = getDb();
      const s = db.select().from(stories).where(eq(stories.id, id)).get();
      if (!s) {
        return respond(
          { found: false },
          {
            summary: `No story with id ${id}.`,
            next: [{ tool: 'get_top_signals', arguments: { limit: 10 }, reason: 'find valid story ids here' }],
          },
        );
      }
      const srcs = db
        .select({
          source: sources.name,
          title: items.title,
          url: items.url,
          publishedAt: items.publishedAt,
        })
        .from(items)
        .innerJoin(sources, eq(items.sourceId, sources.id))
        .where(eq(items.storyId, s.id))
        .all();
      const entities = parseJsonColumn<{ name: string; kind: string }[]>(s.entities, [])
        .filter((e) => e && typeof e === 'object' && typeof e.name === 'string')
        .map((e) => ({ name: String(e.name), kind: String(e.kind ?? 'unknown') }));
      return respond(
        {
          found: true,
          story: {
            id: s.id,
            title: s.title,
            tldr: s.tldr ?? null,
            why_it_matters: s.whyItMatters ?? null,
            top_score: s.topScore,
            domain_scores: parseJsonColumn<Record<string, number>>(s.domainScores, {}),
            entities,
            second_look: s.secondLook ?? null,
            hindsight: s.hindsight ?? null,
            created_at: s.createdAt.toISOString(),
            updated_at: s.updatedAt ? s.updatedAt.toISOString() : null,
            url: `${config.siteUrl}/story/${s.id}`,
            sources: srcs.map((r) => ({
              source: r.source,
              title: r.title,
              url: r.url,
              published_at: r.publishedAt ? r.publishedAt.toISOString() : null,
            })),
          },
        },
        {
          summary: `"${s.title}" — score ${s.topScore}, ${srcs.length} source${srcs.length === 1 ? '' : 's'}${s.hindsight !== null ? `, hindsight grade ${s.hindsight}` : ''}.`,
          next: [
            ...(entities[0]
              ? [
                  {
                    tool: 'get_entity',
                    arguments: { name: entities[0].name },
                    reason: `tracked profile of ${entities[0].name}`,
                  },
                ]
              : []),
            {
              tool: 'get_top_signals',
              arguments: { limit: 10 },
              reason: 'more stories at this level',
            },
          ],
        },
      );
    },
  );
}
