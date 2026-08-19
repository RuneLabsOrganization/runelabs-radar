import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { painPoints } from '../../src/lib/db/schema';
import { envelopeSchema, parseJsonColumn, respond } from '../lib/payload';

export function registerPainTools(server: McpServer): void {
  server.registerTool(
    'get_pain_points',
    {
      description:
        'Unmet needs mined from the intelligence stream, deduped with an intensity counter (times independently observed) and evidence links. Use for "what do people actually struggle with" and idea validation.',
      inputSchema: {
        sector: z.string().optional().describe('sector slug filter'),
        min_intensity: z.number().int().min(1).default(1).describe('times independently observed'),
        limit: z.number().int().min(1).max(50).default(25),
      },
      outputSchema: {
        ...envelopeSchema,
        count: z.number(),
        pains: z.array(
          z.object({
            summary: z.string(),
            sector: z.string().nullable(),
            intensity: z.number(),
            evidence: z.array(z.object({ title: z.string(), url: z.string() })),
            last_seen_at: z.string(),
          }),
        ),
      },
    },
    async ({ sector, min_intensity, limit }) => {
      const db = getDb();
      const conds = [gte(painPoints.intensity, min_intensity)];
      if (sector) conds.push(eq(painPoints.sector, sector));
      const rows = db
        .select()
        .from(painPoints)
        .where(and(...conds))
        .orderBy(desc(painPoints.intensity), desc(painPoints.lastSeenAt))
        .limit(limit)
        .all();
      const top = rows[0];
      return respond(
        {
          count: rows.length,
          pains: rows.map((p) => ({
            summary: p.summary,
            sector: p.sector ?? null,
            intensity: p.intensity,
            evidence: parseJsonColumn<{ title: string; url: string }[]>(p.evidence, [])
              .filter((e) => e && typeof e.title === 'string' && typeof e.url === 'string')
              .map((e) => ({ title: e.title, url: e.url })),
            last_seen_at: p.lastSeenAt.toISOString(),
          })),
        },
        {
          summary:
            rows.length === 0
              ? `No pain points${sector ? ` in ${sector}` : ''} observed at least ${min_intensity} time${min_intensity === 1 ? '' : 's'}.`
              : `${rows.length} pain points${sector ? ` in ${sector}` : ''} — strongest: "${top!.summary}" (intensity ${top!.intensity}).`,
          next: [
            {
              tool: 'get_opportunities',
              arguments: { limit: 5 },
              reason: 'openings already scored against pains like these',
            },
            {
              tool: 'get_comps',
              arguments: { limit: 10 },
              reason: 'what comparable products sold for',
            },
          ],
        },
      );
    },
  );
}
