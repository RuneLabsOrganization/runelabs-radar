import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { reports } from '../../src/lib/db/schema';
import { getIdentity } from '../../src/lib/identity';
import { estimateTokens } from '../../src/lib/mcp-economy';
import { detailSchema, envelopeSchema, respond, withUserEconomy, type DetailLevel } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

/**
 * The weekly "State of the Builder Market" issue. Public data (first-party
 * series only inside — no AA-derived payloads), so no auth gating; the auth
 * context is part of the signature for consistency with the other tools.
 */
export function registerWeeklyTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'get_weekly_report',
    {
      description: `The weekly "State of the Builder Market" report from ${getIdentity().productName}: the week's top signals, board moves, pursue-verdict opportunities, launch pulse, anomalies and market movers — one markdown issue per Sunday. Default detail=compact returns a short excerpt; pass detail=full for the whole issue.`,
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('YYYY-MM-DD of the Sunday issue; default: latest'),
        detail: detailSchema,
      },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        date: z.string().optional(),
        words: z.number().int().optional(),
        detail: z.enum(['summary', 'compact', 'full']).optional(),
        excerpt: z.string().optional(),
        markdown: z.string().optional(),
      },
    },
    async ({ date, detail }) => {
      const level = (detail ?? 'compact') as DetailLevel;
      const db = getDb();
      const row = date
        ? db.select().from(reports).where(eq(reports.date, date)).get()
        : db.select().from(reports).orderBy(desc(reports.date)).limit(1).get();
      if (!row) {
        return respond(
          { found: false },
          {
            summary: date
              ? `No weekly report for ${date} — issues are written every Sunday.`
              : 'No weekly report written yet — the Sunday 08:00 job writes the first one.',
            economy: withUserEconomy(auth.userId, 'weekly'),
            next: [
              {
                tool: 'get_daily_brief',
                arguments: {},
                reason: "today's brief covers the latest signals until the first issue lands",
              },
            ],
          },
        );
      }
      const words = row.markdown.split(/\s+/).length;
      const excerpt = row.markdown.slice(0, 800) + (row.markdown.length > 800 ? '…' : '');
      const fullTokens = estimateTokens(
        JSON.stringify({ found: true, date: row.date, words, markdown: row.markdown }, null, 2),
      );
      const body =
        level === 'full'
          ? { found: true, date: row.date, words, detail: level, markdown: row.markdown }
          : level === 'summary'
            ? { found: true, date: row.date, words, detail: level }
            : { found: true, date: row.date, words, detail: level, excerpt };

      return respond(body, {
        summary: `State of the Builder Market, week of ${row.date} — ${words} words (${level}).`,
        economy: withUserEconomy(auth.userId, 'weekly', { fullTokens }),
        next: [
          {
            tool: 'get_opportunities',
            arguments: {},
            reason: 'the live pursue-verdict list behind the Opportunities section',
          },
          ...(level !== 'full'
            ? [
                {
                  tool: 'get_weekly_report',
                  arguments: { date: row.date, detail: 'full' },
                  reason: 'full markdown issue',
                },
              ]
            : []),
        ],
      });
    },
  );
}
