import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { metricPoints } from '../../src/lib/db/schema';
import { aaModels } from '../../src/lib/analytics';
import { seriesFor } from '../../src/lib/metrics';
import { config } from '../../src/lib/config';
import { envelopeSchema, respond } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

export function registerMarketTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'get_market_models',
    {
      description:
        'The model market right now (Artificial Analysis snapshot): intelligence scores vs token prices per model. Use for "which model gives the most intelligence per dollar" questions and plan cost estimates.',
      inputSchema: {
        limit: z.number().int().min(1).max(60).default(25),
        sort: z.enum(['intelligence', 'price', 'value']).default('value').describe('value = intelligence per $'),
      },
      outputSchema: {
        ...envelopeSchema,
        restricted: z.boolean(),
        reason: z.string().optional(),
        fetched_at: z.string().optional(),
        count: z.number().optional(),
        models: z
          .array(
            z.object({
              name: z.string(),
              org: z.string().nullable(),
              intelligence: z.number(),
              coding: z.number().nullable(),
              price_blended: z.number(),
              price_in: z.number().nullable(),
              price_out: z.number().nullable(),
              speed: z.number().nullable(),
              released: z.string().nullable(),
            }),
          )
          .optional(),
      },
    },
    async ({ limit, sort }) => {
      // AA terms treat republication as redistribution: anonymous access only when AA_PUBLIC=true
      if (!auth.authed && !config.aaPublic) {
        return respond(
          {
            restricted: true,
            reason:
              'Model-market data is available to authenticated agents on this server (AA_PUBLIC=false for anonymous access).',
          },
          {
            summary: 'Model-market data is restricted to authenticated agents on this server.',
            next: [
              {
                tool: 'get_best_right_now',
                arguments: {},
                reason: 'curated picks need no market data',
              },
            ],
          },
        );
      }
      const aa = aaModels(60);
      if (!aa)
        return respond(
          { restricted: false, fetched_at: undefined, count: 0, models: [] },
          {
            summary: 'No market data fetched yet.',
            next: [
              {
                tool: 'get_best_right_now',
                arguments: {},
                reason: 'curated picks need no market data',
              },
            ],
          },
        );
      const models = [...aa.models]
        .sort((a, b) => {
          if (sort === 'intelligence') return b.intelligence - a.intelligence;
          if (sort === 'price') return a.price - b.price;
          return b.intelligence / b.price - a.intelligence / a.price;
        })
        .slice(0, limit)
        .map((m) => ({
          name: m.name,
          org: m.org ?? null,
          intelligence: m.intelligence,
          coding: m.coding ?? null,
          price_blended: m.price,
          price_in: m.priceIn ?? null,
          price_out: m.priceOut ?? null,
          speed: m.speed ?? null,
          released: m.released ?? null,
        }));
      return respond(
        { restricted: false, fetched_at: aa.fetchedAt, count: models.length, models },
        {
          summary:
            models.length === 0
              ? 'The market snapshot has no models.'
              : `${models.length} models ranked by ${sort} — top: "${models[0]!.name}" (intelligence ${models[0]!.intelligence}).`,
          next: [
            {
              tool: 'get_best_right_now',
              arguments: {},
              reason: 'curated picks built on this data',
            },
          ],
        },
      );
    },
  );

  server.registerTool(
    'list_metrics',
    {
      description:
        'Every tracked time series (model prices, arena ELOs, GitHub stars, HF/npm downloads, launch counts) as (source, entity, metric) keys with recency. Pair with get_metric_series.',
      inputSchema: {
        source: z.string().optional().describe('e.g. aa, github, huggingface, npm, launches'),
        limit: z.number().int().min(1).max(200).default(50),
      },
      outputSchema: {
        ...envelopeSchema,
        count: z.number(),
        metrics: z.array(
          z.object({
            source: z.string(),
            entity: z.string(),
            metric: z.string(),
            latest: z.string(),
            points: z.number(),
          }),
        ),
      },
    },
    async ({ source, limit }) => {
      const db = getDb();
      const rows = db
        .select({
          source: metricPoints.source,
          entity: metricPoints.entity,
          metric: metricPoints.metric,
          latest: sql<string>`max(${metricPoints.date})`,
          points: sql<number>`count(*)`,
        })
        .from(metricPoints)
        .where(source ? eq(metricPoints.source, source) : undefined)
        .groupBy(metricPoints.source, metricPoints.entity, metricPoints.metric)
        .orderBy(desc(sql`max(${metricPoints.date})`))
        .limit(limit)
        .all();
      return respond(
        { count: rows.length, metrics: rows },
        {
          summary: `${rows.length} tracked metric series${source ? ` from ${source}` : ''}.`,
          next: rows[0]
            ? [
                {
                  tool: 'get_metric_series',
                  arguments: {
                    source: rows[0].source,
                    entity: rows[0].entity,
                    metric: rows[0].metric,
                    days: 30,
                  },
                  reason: 'read a series',
                },
              ]
            : [],
        },
      );
    },
  );

  server.registerTool(
    'get_metric_series',
    {
      description:
        'One time series from the metrics store, oldest first, with summary stats. Get valid (source, entity, metric) keys from list_metrics.',
      inputSchema: {
        source: z.string(),
        entity: z.string(),
        metric: z.string(),
        days: z.number().int().min(1).max(365).default(90),
      },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        source: z.string(),
        entity: z.string(),
        metric: z.string(),
        first: z.number().optional(),
        last: z.number().optional(),
        delta: z.number().optional(),
        change_pct: z.number().nullable().optional(),
        points: z.array(z.object({ date: z.string(), value: z.number() })),
      },
    },
    async ({ source, entity, metric, days }) => {
      const points = seriesFor(source, entity, metric, days);
      const first = points[0]?.value;
      const last = points[points.length - 1]?.value;
      return respond(
        {
          found: points.length > 0,
          source,
          entity,
          metric,
          ...(first !== undefined ? { first } : {}),
          ...(last !== undefined ? { last } : {}),
          ...(first !== undefined && last !== undefined
            ? {
                delta: Math.round((last - first) * 1000) / 1000,
                change_pct: first !== 0 ? Math.round(((last - first) / first) * 1000) / 10 : null,
              }
            : {}),
          points,
        },
        points.length > 0
          ? {
              summary: `${points.length} points for ${source}/${entity}/${metric} over the last ${days} days.`,
              next: [
                {
                  tool: 'get_forecasts',
                  arguments: {},
                  reason: 'forecasts built from series like this',
                },
              ],
            }
          : {
              summary: `No data for ${source}/${entity}/${metric} in the last ${days} days.`,
              next: [
                {
                  tool: 'list_metrics',
                  arguments: {},
                  reason: 'valid keys here',
                },
              ],
            },
      );
    },
  );
}
