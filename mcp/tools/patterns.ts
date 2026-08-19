import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { patterns } from '../../src/lib/db/schema';
import { daysAgoDay, envelopeSchema, respond } from '../lib/payload';

export function registerPatternTools(server: McpServer): void {
  server.registerTool(
    'get_patterns',
    {
      description:
        '"The machine noticed" — daily anomaly detections, narrated: sector spikes, entity surges, price drops, launch spikes, cluster heat, pain clusters. Use for "anything unusual happening" questions.',
      inputSchema: {
        kind: z
          .enum(['sector-spike', 'entity-surge', 'price-drop', 'launch-spike', 'cluster-heat', 'pain-cluster'])
          .optional(),
        days: z.number().int().min(1).max(90).default(7),
        limit: z.number().int().min(1).max(50).default(25),
      },
      outputSchema: {
        ...envelopeSchema,
        window_days: z.number(),
        count: z.number(),
        patterns: z.array(
          z.object({
            kind: z.string(),
            subject: z.string().nullable(),
            headline: z.string(),
            detail: z.string(),
            score: z.number(),
            date: z.string(),
          }),
        ),
      },
    },
    async ({ kind, days, limit }) => {
      const db = getDb();
      const conds = [gte(patterns.date, daysAgoDay(days))];
      if (kind) conds.push(eq(patterns.kind, kind));
      const rows = db
        .select()
        .from(patterns)
        .where(and(...conds))
        .orderBy(desc(patterns.date), desc(patterns.score))
        .limit(limit)
        .all();
      const firstSubject = rows.find((r) => r.subject)?.subject ?? null;
      return respond(
        {
          window_days: days,
          count: rows.length,
          patterns: rows.map((p) => ({
            kind: p.kind,
            subject: p.subject ?? null,
            headline: p.headline,
            detail: p.detail,
            score: p.score,
            date: p.date,
          })),
        },
        {
          summary:
            rows.length === 0
              ? `No anomalies detected in the last ${days} days.`
              : `${rows.length} anomalies in the last ${days} days — strongest: "${rows[0]!.headline}".`,
          next: [
            ...(firstSubject
              ? [
                  {
                    tool: 'get_entity',
                    arguments: { name: firstSubject },
                    reason: 'profile of the surging subject',
                  },
                ]
              : []),
            {
              tool: 'get_top_signals',
              arguments: {},
              reason: 'the stories behind these anomalies',
            },
          ],
        },
      );
    },
  );
}
