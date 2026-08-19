import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { launches } from '../../src/lib/db/schema';
import { LAUNCH_CATEGORIES } from '../../src/lib/launches';
import { envelopeSchema, hoursAgo, respond } from '../lib/payload';

export function registerLaunchTools(server: McpServer): void {
  server.registerTool(
    'get_launches',
    {
      description:
        'Newest product launches tracked from Show HN and Product Hunt, LLM-tagged by category, with traction (points/comments). Use for "what launched this week" and competitive-scan questions.',
      inputSchema: {
        source: z.enum(['show-hn', 'producthunt']).optional(),
        category: z.enum(LAUNCH_CATEGORIES).optional(),
        days: z.number().int().min(1).max(90).default(7).describe('lookback window'),
        min_points: z.number().int().min(0).optional().describe('minimum traction threshold'),
        limit: z.number().int().min(1).max(50).default(25),
      },
      outputSchema: {
        ...envelopeSchema,
        window_days: z.number(),
        count: z.number(),
        launches: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
            source: z.string(),
            category: z.string().nullable(),
            points: z.number().nullable(),
            comments: z.number().nullable(),
            launched_at: z.string(),
          }),
        ),
      },
    },
    async ({ source, category, days, min_points, limit }) => {
      const db = getDb();
      const conds = [gte(launches.launchedAt, hoursAgo(days * 24))];
      if (source) conds.push(eq(launches.source, source));
      if (category) conds.push(eq(launches.category, category));
      if (min_points !== undefined) conds.push(gte(launches.points, min_points));
      const rows = db
        .select()
        .from(launches)
        .where(and(...conds))
        .orderBy(desc(launches.points), desc(launches.launchedAt))
        .limit(limit)
        .all();
      const top = rows[0];
      return respond(
        {
          window_days: days,
          count: rows.length,
          launches: rows.map((l) => ({
            title: l.title,
            url: l.url,
            source: l.source,
            category: l.category ?? null,
            points: l.points ?? null,
            comments: l.comments ?? null,
            launched_at: l.launchedAt.toISOString(),
          })),
        },
        {
          summary:
            rows.length === 0
              ? `No launches in the last ${days} days${source ? ` from ${source}` : ''}${category ? ` in ${category}` : ''}.`
              : `${rows.length} launches in the last ${days} days${category ? ` in ${category}` : ''} — top: "${top!.title}" (${top!.points ?? 0} points).`,
          next: [
            {
              tool: 'get_comps',
              arguments: { limit: 10 },
              reason: 'money comps for products like these',
            },
            {
              tool: 'get_opportunities',
              arguments: { limit: 5 },
              reason: 'detected openings in the same stream',
            },
          ],
        },
      );
    },
  );
}
