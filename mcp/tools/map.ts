import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { topicHierarchy, topicHierarchyAsOf } from '../../src/lib/analytics';
import { envelopeSchema, respond } from '../lib/payload';

const subSchema = z.object({
  id: z.number().int(),
  label: z.string(),
  summary: z.string().nullable(),
  size: z.number(),
  heat: z.number(),
  sector: z.string().nullable(),
});

export function registerMapTools(server: McpServer): void {
  server.registerTool(
    'get_topic_map',
    {
      description:
        'The semantic map of what the AI conversation is about right now: macro topic clusters and their subtopics, sized and heat-scored (recency-weighted activity). Regenerated daily.',
      inputSchema: {},
      outputSchema: {
        ...envelopeSchema,
        as_of: z.string().nullable(),
        count: z.number(),
        topics: z.array(subSchema.extend({ children: z.array(subSchema) })),
      },
    },
    async () => {
      const tree = topicHierarchy() ?? [];
      const topics = tree.map((m) => ({
        id: m.id,
        label: m.label,
        summary: m.summary ?? null,
        size: m.size,
        heat: m.heat,
        sector: m.sector ?? null,
        children: m.children.map((c) => ({
          id: c.id,
          label: c.label,
          summary: c.summary ?? null,
          size: c.size,
          heat: c.heat,
          sector: c.sector ?? null,
        })),
      }));
      const asOf = topicHierarchyAsOf();
      return respond(
        { as_of: asOf, count: topics.length, topics },
        {
          summary:
            topics.length === 0
              ? 'No topic clusters computed yet.'
              : `${topics.length} macro topic clusters on the map${asOf ? ` as of ${asOf}` : ''}.`,
          next: [
            {
              tool: 'get_top_signals',
              arguments: { limit: 10 },
              reason: 'top stories inside the hot clusters',
            },
          ],
        },
      );
    },
  );
}
