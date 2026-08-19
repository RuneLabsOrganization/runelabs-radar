import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { comps } from '../../src/lib/db/schema';
import { envelopeSchema, respond } from '../lib/payload';

export function registerCompTools(server: McpServer): void {
  server.registerTool(
    'get_comps',
    {
      description:
        'Money comps observed in the stream: exits and revenue numbers for AI products, with source links. Use for pricing, market sizing, and "what do these things sell for" questions.',
      inputSchema: {
        kind: z.enum(['exit', 'revenue']).optional(),
        limit: z.number().int().min(1).max(50).default(25),
      },
      outputSchema: {
        ...envelopeSchema,
        count: z.number(),
        comps: z.array(
          z.object({
            kind: z.string(),
            product: z.string(),
            amount_usd: z.number().nullable(),
            note: z.string().nullable(),
            source_url: z.string().nullable(),
            recorded_at: z.string(),
          }),
        ),
      },
    },
    async ({ kind, limit }) => {
      const db = getDb();
      const rows = db
        .select()
        .from(comps)
        .where(kind ? eq(comps.kind, kind) : undefined)
        .orderBy(desc(comps.createdAt))
        .limit(limit)
        .all();
      return respond(
        {
          count: rows.length,
          comps: rows.map((c) => ({
            kind: c.kind,
            product: c.product,
            amount_usd: c.amountUsd ?? null,
            note: c.note ?? null,
            source_url: c.sourceUrl ?? null,
            recorded_at: c.createdAt.toISOString(),
          })),
        },
        {
          summary: `${rows.length} money comps${kind ? ` of kind "${kind}"` : ''} on record.`,
          next: [
            {
              tool: 'get_opportunities',
              arguments: { limit: 5 },
              reason: 'openings these comps de-risk',
            },
            {
              tool: 'get_pain_points',
              arguments: { limit: 10 },
              reason: 'demand side',
            },
          ],
        },
      );
    },
  );
}
