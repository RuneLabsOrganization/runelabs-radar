import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { stacks } from '../../src/lib/db/schema';
import { envelopeSchema, iso, parseJsonColumn, respond } from '../lib/payload';

interface StackLayerRow {
  layer: string;
  pick: string;
  alt?: string;
  note?: string;
}

export function registerStackTools(server: McpServer): void {
  server.registerTool(
    'list_stacks',
    {
      description: 'All venture playbooks available for get_stack_for, with taglines and time-to-MVP estimates.',
      inputSchema: {},
      outputSchema: {
        ...envelopeSchema,
        count: z.number(),
        stacks: z.array(
          z.object({
            venture: z.string(),
            title: z.string(),
            tagline: z.string().nullable(),
            time_to_mvp: z.string().nullable(),
            updated_at: z.string().nullable(),
          }),
        ),
      },
    },
    async () => {
      const db = getDb();
      const rows = db.select().from(stacks).orderBy(desc(stacks.updatedAt)).all();
      return respond(
        {
          count: rows.length,
          stacks: rows.map((s) => ({
            venture: s.venture,
            title: s.title,
            tagline: s.tagline ?? null,
            time_to_mvp: s.timeToMvp ?? null,
            updated_at: iso(s.updatedAt),
          })),
        },
        {
          summary: `${rows.length} venture playbooks available.`,
          next: rows[0]
            ? [
                {
                  tool: 'get_stack_for',
                  arguments: { venture: rows[0].venture },
                  reason: 'read a playbook',
                },
              ]
            : [],
        },
      );
    },
  );

  server.registerTool(
    'get_stack_for',
    {
      description:
        'The ship-it-today tech stack playbook for a venture type (layers: pick, alternative, cost note). Use for "what stack should I build X with" questions.',
      inputSchema: {
        venture: z.string().describe('venture slug, e.g. saas-b2b, ai-product, mobile-app — see list_stacks'),
      },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        available: z.array(z.string()).optional(),
        venture: z.string().optional(),
        title: z.string().optional(),
        tagline: z.string().nullable().optional(),
        time_to_mvp: z.string().nullable().optional(),
        run_cost: z.string().nullable().optional(),
        layers: z
          .array(
            z.object({
              layer: z.string(),
              pick: z.string(),
              alt: z.string().optional(),
              note: z.string().optional(),
            }),
          )
          .optional(),
        rationale: z.string().nullable().optional(),
        verdict: z.string().nullable().optional(),
        updated_at: z.string().nullable().optional(),
      },
    },
    async ({ venture }) => {
      const db = getDb();
      const row = db.select().from(stacks).where(eq(stacks.venture, venture)).get();
      if (!row) {
        const available = db
          .select({ v: stacks.venture })
          .from(stacks)
          .all()
          .map((r) => r.v);
        return respond(
          { found: false, available },
          {
            summary: `No playbook for venture "${venture}".`,
            next: [
              {
                tool: 'list_stacks',
                arguments: {},
                reason: 'available playbooks',
              },
            ],
          },
        );
      }
      const layers = parseJsonColumn<StackLayerRow[]>(row.layers, []).map((l) => ({
        layer: String(l.layer),
        pick: String(l.pick),
        ...(l.alt ? { alt: String(l.alt) } : {}),
        ...(l.note ? { note: String(l.note) } : {}),
      }));
      return respond(
        {
          found: true,
          venture: row.venture,
          title: row.title,
          tagline: row.tagline ?? null,
          time_to_mvp: row.timeToMvp ?? null,
          run_cost: row.costNote ?? null,
          layers,
          rationale: row.rationale ?? null,
          verdict: row.runelabsVerdict ?? null,
          updated_at: iso(row.updatedAt),
        },
        {
          summary: `Playbook for ${row.venture}: ${layers.length} layers${row.timeToMvp ? `, time to MVP ${row.timeToMvp}` : ''}.`,
          next: [
            {
              tool: 'get_opportunities',
              arguments: { limit: 5 },
              reason: 'openings this stack could serve',
            },
          ],
        },
      );
    },
  );
}
