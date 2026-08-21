import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { envelopeSchema, respond } from '../lib/payload';
import { AGENT_STACKS_REVIEWED_AT, PERSONA_SLUGS, costBand, type AgentPersona } from '../../src/lib/agent-stacks';
import { publishedAgentStacks, publishedPersona } from '../../src/lib/agent-stacks-sync';
import { config } from '../../src/lib/config';

function personaPayload(p: AgentPersona) {
  return {
    slug: p.slug,
    label: p.label,
    stack: p.stack,
    ide: p.ide,
    harness: p.harness,
    model: p.model,
    cost: costBand(p),
    cost_low_usd: p.costLowUsd,
    cost_high_usd: p.costHighUsd,
    why: p.why,
    skip: p.skip,
  };
}

export function registerAgentStackTools(server: McpServer): void {
  server.registerTool(
    'list_agent_stacks',
    {
      description:
        'Coding-agent stacks builders actually run: IDE + harness + model by persona, survey love-rates, and this week’s mention heat. Use for "Cursor vs Claude Code vs Codex" / vibe-coding stack questions. Distinct from list_stacks (venture product playbooks).',
      inputSchema: {},
      outputSchema: {
        ...envelopeSchema,
        reviewed_at: z.string(),
        hub_url: z.string(),
        persona_count: z.number(),
        personas: z.array(
          z.object({
            slug: z.string(),
            label: z.string(),
            stack: z.string(),
            cost: z.string(),
            cost_low_usd: z.number(),
            cost_high_usd: z.number(),
          }),
        ),
        landscape: z.array(
          z.object({
            name: z.string(),
            kind: z.string(),
            loved_pct: z.number(),
            loved_source: z.enum(['pe-survey', 'remainder']),
            mentions_7d: z.number(),
            role: z.string(),
            loses: z.string(),
            sticker: z.string(),
          }),
        ),
        pairings: z.array(
          z.object({
            job: z.string(),
            model: z.string(),
            harness: z.string(),
          }),
        ),
        default_app_stack: z.object({
          title: z.string(),
          note: z.string(),
        }),
      },
    },
    async () => {
      const pub = publishedAgentStacks();
      const top = pub.landscape[0];
      return respond(
        {
          reviewed_at: AGENT_STACKS_REVIEWED_AT,
          hub_url: `${config.siteUrl}/agent-stacks`,
          persona_count: pub.personas.length,
          personas: pub.personas.map((p) => ({
            slug: p.slug,
            label: p.label,
            stack: p.stack,
            cost: costBand(p),
            cost_low_usd: p.costLowUsd,
            cost_high_usd: p.costHighUsd,
          })),
          landscape: pub.landscape.map((h) => ({
            name: h.name,
            kind: h.kind,
            loved_pct: h.lovedPct,
            loved_source: h.lovedSource,
            mentions_7d: h.mentions7d,
            role: h.role,
            loses: h.loses,
            sticker: h.sticker,
          })),
          pairings: pub.pairings,
          default_app_stack: pub.defaultAppStack,
        },
        {
          summary: `${pub.personas.length} agent-stack personas; most-loved harness is ${top?.name ?? 'unranked'} (${top?.lovedPct ?? '—'}%).`,
          next: [
            {
              tool: 'get_agent_stack_for',
              arguments: { persona: 'indie' },
              reason: 'full playbook for the default indie/senior persona',
            },
          ],
        },
      );
    },
  );

  server.registerTool(
    'get_agent_stack_for',
    {
      description:
        'The recommended IDE + harness + model stack for a builder persona (indie, daily, budget, power, nocoder, enterprise). Use after list_agent_stacks or when the user said who they are.',
      inputSchema: {
        persona: z
          .string()
          .describe('persona slug or label fragment, e.g. indie, budget, non-coder, enterprise — see list_agent_stacks'),
      },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        available: z.array(z.string()).optional(),
        reviewed_at: z.string().optional(),
        hub_url: z.string().optional(),
        slug: z.string().optional(),
        label: z.string().optional(),
        stack: z.string().optional(),
        ide: z.string().optional(),
        harness: z.string().optional(),
        model: z.string().optional(),
        cost: z.string().optional(),
        cost_low_usd: z.number().optional(),
        cost_high_usd: z.number().optional(),
        why: z.string().optional(),
        skip: z.string().optional(),
      },
    },
    async ({ persona }) => {
      const row = publishedPersona(persona);
      if (!row) {
        return respond(
          { found: false, available: [...PERSONA_SLUGS] },
          {
            summary: `No agent-stack persona "${persona}".`,
            next: [
              {
                tool: 'list_agent_stacks',
                arguments: {},
                reason: 'available personas and the landscape',
              },
            ],
          },
        );
      }
      return respond(
        {
          found: true,
          reviewed_at: AGENT_STACKS_REVIEWED_AT,
          hub_url: `${config.siteUrl}/agent-stacks#${row.slug}`,
          ...personaPayload(row),
        },
        {
          summary: `For ${row.label}: ${row.stack} (${costBand(row)}).`,
          next: [
            {
              tool: 'list_agent_stacks',
              arguments: {},
              reason: 'landscape + other personas',
            },
            {
              tool: 'get_best_right_now',
              arguments: { domain: 'coding' },
              reason: 'board picks for coding tasks',
            },
          ],
        },
      );
    },
  );
}
