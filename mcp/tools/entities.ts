import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { entityDailySeries, topEntities } from '../../src/lib/analytics';
import { canonicalEntityKey, entitySlug, resolveEntity } from '../../src/lib/entity';
import { boardPlacements, coMentioned } from '../../src/lib/entity-extras';
import { config } from '../../src/lib/config';
import { envelopeSchema, respond } from '../lib/payload';

export function registerEntityTools(server: McpServer): void {
  server.registerTool(
    'get_entity',
    {
      description:
        'Profile of a model, tool, org, or technique tracked in the intelligence graph: mention counts and trend, where it sits on the best-right-now board, and what it gets mentioned alongside.',
      inputSchema: { name: z.string().min(1).max(120).describe('entity name, e.g. "Claude Sonnet 4.5", "Cursor", "OpenAI"') },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        suggestions: z.array(z.string()).optional(),
        entity: z
          .object({
            name: z.string(),
            kind: z.string(),
            mentions: z.number(),
            mentions_14d: z.array(z.number()),
            board_placements: z.array(
              z.object({ domain: z.string(), task: z.string(), role: z.string() }),
            ),
            co_mentioned: z.array(z.object({ name: z.string(), slug: z.string(), count: z.number() })),
            url: z.string(),
          })
          .optional(),
      },
    },
    async ({ name }) => {
      const base = resolveEntity(entitySlug(name));
      if (!base) {
        return respond(
          { found: false, suggestions: topEntities(5).map((e) => e.name) },
          {
            summary: `No tracked entity named "${name}".`,
            next: [
              {
                tool: 'get_top_signals',
                arguments: { limit: 10 },
                reason: 'see what is on the scope',
              },
            ],
          },
        );
      }
      const series = entityDailySeries([base.name], 14).get(canonicalEntityKey(base.name)) ?? [];
      const placements = boardPlacements(base.name);
      const co = coMentioned(base.name, 6);
      return respond(
        {
          found: true,
          entity: {
            name: base.name,
            kind: base.kind,
            mentions: base.mentions,
            mentions_14d: series,
            board_placements: placements.map((b) => ({
              domain: b.domain,
              task: b.task,
              role: b.role,
            })),
            co_mentioned: co.map((c) => ({
              name: c.name,
              slug: c.slug,
              count: c.count,
            })),
            url: `${config.siteUrl}/entity/${entitySlug(base.name)}`,
          },
        },
        {
          summary: `"${base.name}" (${base.kind}) — ${base.mentions} mentions, ${placements.length} board placements.`,
          next: [
            {
              tool: 'search_stories',
              arguments: { query: base.name, limit: 5 },
              reason: 'stories mentioning it',
            },
          ],
        },
      );
    },
  );
}
