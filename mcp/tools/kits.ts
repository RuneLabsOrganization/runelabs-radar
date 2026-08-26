import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { KIT_PERSONAS, KIT_PERSONA_SLUGS, getKitPersona } from '../../src/lib/kits/personas';
import { KIT_TIERS, type KitTier } from '../../src/lib/kits/grid';
import { loadKit } from '../../src/lib/kits/repo';
import type { Kit } from '../../src/lib/kits/compose';
import { envelopeSchema, iso, respond, withUserEconomy } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

const tierSchema = z.enum(KIT_TIERS);

const lineSchema = z.object({
  category: z.string(),
  task: z.string(),
  pick: z.string().nullable(),
  url: z.string().nullable(),
  price_model: z.string().nullable(),
  price_usd_month: z.number().nullable(),
  why: z.string().nullable(),
  skip: z.string().nullable(),
  confidence: z.string().nullable(),
  evidence_count: z.number().nullable(),
  verified_at: z.string().nullable(),
  risk_flag: z.string().nullable(),
});

const kitOutput = {
  ...envelopeSchema,
  found: z.boolean(),
  available: z.array(z.string()).optional(),
  persona: z.string().optional(),
  label: z.string().optional(),
  tier: z.string().optional(),
  total_usd_month: z.number().optional(),
  covered: z.number().optional(),
  total_cells: z.number().optional(),
  lines: z.array(lineSchema).optional(),
  usage_risk: z
    .array(z.object({ pick: z.string(), category: z.string(), task: z.string(), risk: z.string().nullable() }))
    .optional(),
  gaps: z.array(z.object({ category: z.string(), task: z.string() })).optional(),
};

/** Kit -> MCP payload. Shared by get_kit and get_my_kit so the shape can't drift. */
export function kitPayload(kit: Kit): Record<string, unknown> {
  return {
    found: true,
    persona: kit.persona,
    label: kit.label,
    tier: kit.tier,
    total_usd_month: kit.totalUsdMonth,
    covered: kit.coveredCount,
    total_cells: kit.totalCount,
    lines: kit.lines.map((l) => ({
      category: l.category,
      task: l.task,
      pick: l.pick?.pickName ?? null,
      url: l.pick?.pickUrl ?? null,
      price_model: l.pick?.priceModel ?? null,
      price_usd_month: l.pick?.priceUsdMonth ?? null,
      why: l.pick?.why ?? null,
      skip: l.pick?.skip ?? null,
      confidence: l.pick?.confidence ?? null,
      evidence_count: l.pick?.evidenceCount ?? null,
      verified_at: l.pick ? iso(l.pick.verifiedAt) : null,
      risk_flag: l.pick?.riskFlag ?? null,
    })),
    usage_risk: kit.usageRisk.map((p) => ({
      pick: p.pickName,
      category: p.category,
      task: p.task,
      risk: p.riskFlag,
    })),
    gaps: kit.gaps.map((g) => ({ category: g.category, task: g.task })),
  };
}

export function kitSummary(kit: Kit): string {
  const usage = kit.usageRisk.length ? `, ${kit.usageRisk.length} usage-priced excluded` : '';
  return `${kit.label} (${kit.tier}): $${kit.totalUsdMonth}/mo across ${kit.coveredCount} of ${kit.totalCount} cells${usage}.`;
}

export function registerKitTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'list_kits',
    {
      description:
        'All persona kits available for get_kit — the roster of roles Radar composes a costed tool setup for.',
      inputSchema: {},
      outputSchema: {
        ...envelopeSchema,
        count: z.number(),
        kits: z.array(
          z.object({
            persona: z.string(),
            label: z.string(),
            blurb: z.string(),
            cells: z.number(),
            default_tier: z.string(),
          }),
        ),
      },
    },
    async () =>
      respond(
        {
          count: KIT_PERSONAS.length,
          kits: KIT_PERSONAS.map((p) => ({
            persona: p.slug,
            label: p.label,
            blurb: p.blurb,
            cells: p.routes.length,
            default_tier: p.defaultTier,
          })),
        },
        {
          summary: `${KIT_PERSONAS.length} persona kits available.`,
          economy: withUserEconomy(auth.userId, 'read'),
          next: [
            { tool: 'get_kit', arguments: { persona: 'indie-dev' }, reason: 'read a costed kit' },
          ],
        },
      ),
  );

  server.registerTool(
    'get_kit',
    {
      description:
        'The costed tool kit for a persona: one pick per job at the chosen cost tier, a monthly total (usage-priced picks excluded and flagged separately), and the cells not yet covered. Use for "what should I actually be running / what does it cost".',
      inputSchema: {
        persona: z.string().describe('persona slug — see list_kits'),
        tier: tierSchema.optional().describe("cost tier; defaults to the persona's own default"),
        exclude: z
          .array(z.string())
          .optional()
          .describe('"category/task" keys to drop, e.g. ["audio/music"] if you already have one'),
      },
      outputSchema: kitOutput,
    },
    async ({ persona, tier, exclude }) => {
      const p = getKitPersona(persona);
      if (!p) {
        return respond(
          { found: false, available: KIT_PERSONA_SLUGS },
          {
            summary: `No kit for persona "${persona}".`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'list_kits', arguments: {}, reason: 'available personas' }],
          },
        );
      }
      const chosen: KitTier = tier ?? p.defaultTier;
      const kit = loadKit(p, chosen, exclude);
      return respond(kitPayload(kit), {
        summary: kitSummary(kit),
        economy: withUserEconomy(auth.userId, 'read'),
        // `exclude` can empty the route list, so never index lines[0] blindly.
        next: kit.lines[0]
          ? [
              {
                tool: 'explain_pick',
                arguments: { category: kit.lines[0].category, task: kit.lines[0].task, tier: chosen },
                reason: 'see the evidence behind a pick',
              },
            ]
          : [],
      });
    },
  );
}
