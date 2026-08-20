import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { reports } from '../../src/lib/db/schema';
import { getIdentity } from '../../src/lib/identity';
import { envelopeSchema, respond } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

/**
 * The weekly "State of the Builder Market" issue. Public data (first-party
 * series only inside — no AA-derived payloads), so no auth gating; the auth
 * context is part of the signature for consistency with the other tools.
 */
export function registerWeeklyTools(server: McpServer, _auth: AuthContext): void {
  server.registerTool(
    'get_weekly_report',
    {
      description: `The weekly "State of the Builder Market" report from ${getIdentity().productName}: the week's top signals, board moves, pursue-verdict opportunities, launch pulse, anomalies and market movers — one markdown issue per Sunday. Returns the latest issue unless a date is given.`,
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('YYYY-MM-DD of the Sunday issue; default: latest'),
      },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        date: z.string().optional(),
        words: z.number().int().optional(),
        markdown: z.string().optional(),
      },
    },
    async ({ date }) => {
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
      return respond(
        { found: true, date: row.date, words, markdown: row.markdown },
        {
          summary: `State of the Builder Market, week of ${row.date} — ${words} words.`,
          next: [
            {
              tool: 'get_opportunities',
              arguments: {},
              reason: 'the live pursue-verdict list behind the Opportunities section',
            },
          ],
        },
      );
    },
  );
}
