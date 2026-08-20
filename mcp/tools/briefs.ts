import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { briefs, domainDigests, insights } from '../../src/lib/db/schema';
import { getIdentity } from '../../src/lib/identity';
import { DOMAINS } from '../../src/lib/domains';
import { envelopeSchema, parseJsonColumn, respond, text } from '../lib/payload';

export function registerBriefTools(server: McpServer): void {
  server.registerTool(
    'get_daily_brief',
    {
      description: `The daily AI intelligence brief from ${getIdentity().productName} (top stories, why they matter, board changes). Returns markdown.`,
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD; default: latest'),
      },
    },
    async ({ date }) => {
      const db = getDb();
      const row = date
        ? db.select().from(briefs).where(eq(briefs.date, date)).get()
        : db.select().from(briefs).orderBy(desc(briefs.date)).limit(1).get();
      if (!row) return text(`No brief found${date ? ` for ${date}` : ''}.`);
      return text(row.markdown);
    },
  );

  server.registerTool(
    'get_domain_digest',
    {
      description:
        'Two-line analytical digest per domain for a day — the fastest way to catch up on one domain (or all six). Written daily by the brief job.',
      inputSchema: {
        domain: z.enum(DOMAINS).optional().describe('omit for all domains'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD; default: latest available'),
      },
      outputSchema: {
        ...envelopeSchema,
        date: z.string().nullable(),
        digests: z.array(z.object({ domain: z.string(), text: z.string() })),
      },
    },
    async ({ domain, date }) => {
      const db = getDb();
      const day =
        date ??
        db.select({ date: domainDigests.date }).from(domainDigests).orderBy(desc(domainDigests.date)).limit(1).get()
          ?.date;
      if (!day)
        return respond(
          { date: null, digests: [] },
          {
            summary: 'No domain digests written yet.',
            next: [
              {
                tool: 'get_top_signals',
                arguments: domain ? { domain } : {},
                reason: 'the stories behind the digest',
              },
            ],
          },
        );
      const conds = [eq(domainDigests.date, day)];
      if (domain) conds.push(eq(domainDigests.domain, domain));
      const rows = db.select().from(domainDigests).where(and(...conds)).all();
      return respond(
        { date: day, digests: rows.map((r) => ({ domain: r.domain, text: r.text })) },
        {
          summary: `${rows.length} domain digests for ${day}.`,
          next: [
            {
              tool: 'get_top_signals',
              arguments: domain ? { domain } : {},
              reason: 'the stories behind the digest',
            },
          ],
        },
      );
    },
  );

  server.registerTool(
    'get_daily_insights',
    {
      description:
        'Analyst notes for a day: headline + detail + direction (up/down/watch) per development, written by the daily brief job.',
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD; default: latest available'),
      },
      outputSchema: {
        ...envelopeSchema,
        date: z.string().nullable(),
        items: z.array(
          z.object({
            headline: z.string(),
            detail: z.string(),
            direction: z.string().optional(),
            domain: z.string().optional(),
          }),
        ),
      },
    },
    async ({ date }) => {
      const db = getDb();
      const row = date
        ? db.select().from(insights).where(eq(insights.date, date)).get()
        : db.select().from(insights).orderBy(desc(insights.date)).limit(1).get();
      if (!row)
        return respond(
          { date: null, items: [] },
          {
            summary: `No insights recorded${date ? ` for ${date}` : ''} yet.`,
            next: [
              {
                tool: 'get_top_signals',
                arguments: {},
                reason: 'underlying stories',
              },
            ],
          },
        );
      const parsed = parseJsonColumn<unknown>(row.items, null);
      const items = Array.isArray(parsed)
        ? parsed
            .filter((i) => i && typeof i.headline === 'string' && typeof i.detail === 'string')
            .map((i) => ({
              headline: String(i.headline),
              detail: String(i.detail),
              ...(typeof i.direction === 'string' ? { direction: i.direction } : {}),
              ...(typeof i.domain === 'string' ? { domain: i.domain } : {}),
            }))
        : [];
      return respond(
        { date: row.date, items },
        {
          summary: `${items.length} insights for ${row.date}.`,
          next: [
            {
              tool: 'get_top_signals',
              arguments: {},
              reason: 'underlying stories',
            },
          ],
        },
      );
    },
  );
}
