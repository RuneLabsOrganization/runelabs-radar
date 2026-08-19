import { desc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { boardEntries, boardHistory } from '../../src/lib/db/schema';
import { DOMAINS } from '../../src/lib/domains';
import { envelopeSchema, hoursAgo, iso, respond } from '../lib/payload';

const domainEnum = z.enum(DOMAINS).optional();

export function registerBoardTools(server: McpServer): void {
  server.registerTool(
    'get_best_right_now',
    {
      description:
        'The cost-benefit board: best overall / best value / cheapest viable AI model or tool per task in a domain, with cost notes and human verdicts. Weekly-synced. Use for "what should I use for X" questions.',
      inputSchema: { domain: domainEnum.describe('domain; omit for all domains') },
      outputSchema: {
        ...envelopeSchema,
        count: z.number(),
        board: z.array(
          z.object({
            domain: z.string(),
            task: z.string(),
            best_overall: z.string().nullable(),
            best_value: z.string().nullable(),
            cheapest_viable: z.string().nullable(),
            cost_note: z.string().nullable(),
            verdict: z.string().nullable(),
            updated_at: z.string().nullable(),
          }),
        ),
      },
    },
    async ({ domain }) => {
      const db = getDb();
      const rows = db
        .select()
        .from(boardEntries)
        .where(domain ? eq(boardEntries.domain, domain) : undefined)
        .orderBy(boardEntries.domain, boardEntries.task)
        .all();
      return respond(
        {
          count: rows.length,
          board: rows.map((r) => ({
            domain: r.domain,
            task: r.task,
            best_overall: r.bestOverall ?? null,
            best_value: r.bestValue ?? null,
            cheapest_viable: r.cheapestViable ?? null,
            cost_note: r.costNote ?? null,
            verdict: r.runelabsVerdict ?? null,
            updated_at: iso(r.updatedAt),
          })),
        },
        {
          summary: `${rows.length} board entries for ${domain ?? 'all domains'}.`,
          next: [
            {
              tool: 'get_market_models',
              arguments: {},
              reason: 'sanity-check picks against live prices',
            },
            {
              tool: 'get_board_changes',
              arguments: {},
              reason: 'what changed recently',
            },
          ],
        },
      );
    },
  );

  server.registerTool(
    'get_board_changes',
    {
      description:
        'Recent changes to the best-right-now board: which model/tool replaced which, per task. Use for "what changed since last week" and to catch when a pick stops being the best.',
      inputSchema: {
        days: z.number().int().min(1).max(180).default(30),
        limit: z.number().int().min(1).max(50).default(25),
      },
      outputSchema: {
        ...envelopeSchema,
        window_days: z.number(),
        count: z.number(),
        changes: z.array(
          z.object({
            domain: z.string(),
            task: z.string(),
            change: z.string(),
            applied_at: z.string(),
          }),
        ),
      },
    },
    async ({ days, limit }) => {
      const db = getDb();
      const rows = db
        .select()
        .from(boardHistory)
        .where(gt(boardHistory.appliedAt, hoursAgo(days * 24)))
        .orderBy(desc(boardHistory.appliedAt))
        .limit(limit)
        .all();
      return respond(
        {
          window_days: days,
          count: rows.length,
          changes: rows.map((r) => ({
            domain: r.domain,
            task: r.task,
            change: r.change,
            applied_at: r.appliedAt.toISOString(),
          })),
        },
        {
          summary:
            rows.length === 0
              ? `No board changes in the last ${days} days.`
              : `${rows.length} board changes in the last ${days} days — latest: ${rows[0]!.domain}/${rows[0]!.task}.`,
          next: [
            {
              tool: 'get_best_right_now',
              arguments: {},
              reason: 'current picks after these changes',
            },
          ],
        },
      );
    },
  );
}
