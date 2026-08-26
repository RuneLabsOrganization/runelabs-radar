import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { kitEvidence, kitPicks, userProfiles } from '../../src/lib/db/schema';
import { KIT_PERSONAS, KIT_PERSONA_SLUGS, getKitPersona } from '../../src/lib/kits/personas';
import { isKitCell, KIT_TIERS, type KitTier } from '../../src/lib/kits/grid';
import { loadKit, loadKitPickHistory } from '../../src/lib/kits/repo';
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
  /** True when total_usd_month omits one or more covered picks with no price on file — never a bare $0 claim. */
  total_is_partial: z.boolean().optional(),
  covered: z.number().optional(),
  total_cells: z.number().optional(),
  lines: z.array(lineSchema).optional(),
  unpriced: z
    .array(z.object({ pick: z.string(), category: z.string(), task: z.string() }))
    .optional(),
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
    total_is_partial: kit.unpriced.length > 0,
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
    unpriced: kit.unpriced.map((p) => ({ pick: p.pickName, category: p.category, task: p.task })),
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
  const partial = kit.unpriced.length ? ` (partial — ${kit.unpriced.length} covered pick(s) have no price on file)` : '';
  return `${kit.label} (${kit.tier}): $${kit.totalUsdMonth}/mo${partial} across ${kit.coveredCount} of ${kit.totalCount} cells${usage}.`;
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

  server.registerTool(
    'explain_pick',
    {
      description:
        'The evidence behind one kit pick: why it won, what to skip, and the source reports or benchmarks backing it. Radar never asserts a verdict without receipts.',
      inputSchema: {
        category: z.string().describe('kit category, e.g. video, infra, connectors'),
        task: z.string().describe('job within the category, e.g. text-to-video'),
        tier: tierSchema.optional().describe('cost tier; default value'),
      },
      outputSchema: {
        ...envelopeSchema,
        found: z.boolean(),
        reason: z.string().optional(),
        pick: z.string().optional(),
        why: z.string().nullable().optional(),
        skip: z.string().nullable().optional(),
        confidence: z.string().optional(),
        verified_at: z.string().nullable().optional(),
        evidence: z
          .array(
            z.object({
              kind: z.string(),
              source_url: z.string(),
              excerpt: z.string().nullable(),
              sentiment: z.number(),
              observed_at: z.string().nullable(),
            }),
          )
          .optional(),
      },
    },
    async ({ category, task, tier }) => {
      const chosen: KitTier = tier ?? 'value';
      if (!isKitCell(category, task)) {
        return respond(
          { found: false, reason: `"${category}/${task}" is not a cell in the kit grid.` },
          {
            summary: `Unknown cell ${category}/${task}.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'list_kits', arguments: {}, reason: 'personas and their cells' }],
          },
        );
      }
      const db = getDb();
      const row = db
        .select()
        .from(kitPicks)
        .where(
          and(eq(kitPicks.category, category), eq(kitPicks.task, task), eq(kitPicks.tier, chosen)),
        )
        .get();
      if (!row) {
        return respond(
          { found: false, reason: 'not yet covered — no approved pick for this cell' },
          {
            summary: `${category}/${task} (${chosen}) is not yet covered.`,
            economy: withUserEconomy(auth.userId, 'read'),
          },
        );
      }
      const evidence = db
        .select()
        .from(kitEvidence)
        .where(eq(kitEvidence.pickId, row.id))
        .orderBy(desc(kitEvidence.observedAt))
        .limit(20)
        .all();
      return respond(
        {
          found: true,
          pick: row.pickName,
          why: row.why ?? null,
          skip: row.skip ?? null,
          confidence: row.confidence,
          verified_at: iso(row.verifiedAt),
          evidence: evidence.map((e) => ({
            kind: e.kind,
            source_url: e.sourceUrl,
            excerpt: e.excerpt ?? null,
            sentiment: e.sentiment,
            observed_at: iso(e.observedAt),
          })),
        },
        {
          summary: `${row.pickName} for ${category}/${task} (${chosen}) — ${row.confidence} confidence, ${evidence.length} receipts.`,
          economy: withUserEconomy(auth.userId, 'read'),
        },
      );
    },
  );

  server.registerTool(
    'set_my_kit',
    {
      description:
        'Save the caller persona and cost tier so get_my_kit can return their committed setup without being told again.',
      inputSchema: {
        persona: z.string().describe('persona slug — see list_kits'),
        tier: tierSchema.optional(),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        available: z.array(z.string()).optional(),
        persona: z.string().optional(),
        tier: z.string().optional(),
      },
    },
    async ({ persona, tier }) => {
      if (auth.userId == null) {
        return respond(
          { ok: false, error: 'sign in required — connect with an OAuth token that has a user' },
          {
            summary: 'Sign in required to save a kit.',
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'get_server_guide', arguments: {}, reason: 'how to authenticate' }],
          },
        );
      }
      const p = getKitPersona(persona);
      if (!p) {
        return respond(
          { ok: false, error: `Unknown persona "${persona}".`, available: KIT_PERSONA_SLUGS },
          {
            summary: `Unknown persona "${persona}".`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'list_kits', arguments: {}, reason: 'available personas' }],
          },
        );
      }
      const chosen: KitTier = tier ?? p.defaultTier;
      const db = getDb();
      const now = new Date();
      db.insert(userProfiles)
        .values({ userId: auth.userId, kitPersona: p.slug, kitTier: chosen, updatedAt: now })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: { kitPersona: p.slug, kitTier: chosen, updatedAt: now },
        })
        .run();
      return respond(
        { ok: true, persona: p.slug, tier: chosen },
        {
          summary: `Saved kit: ${p.label} (${chosen}).`,
          economy: withUserEconomy(auth.userId, 'read'),
          next: [{ tool: 'get_my_kit', arguments: {}, reason: 'read your committed setup' }],
        },
      );
    },
  );

  server.registerTool(
    'get_my_kit',
    {
      description:
        "The caller's own saved kit — the tool decisions they have already committed to. Read this before proposing a stack so you build on their choices instead of re-litigating them.",
      inputSchema: {},
      outputSchema: kitOutput,
    },
    async () => {
      if (auth.userId == null) {
        return respond(
          { found: false, available: KIT_PERSONA_SLUGS },
          {
            summary: 'Sign in required to read a saved kit.',
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'get_kit', arguments: { persona: 'indie-dev' }, reason: 'browse a kit anonymously' }],
          },
        );
      }
      const db = getDb();
      const profile = db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, auth.userId))
        .get();
      const p = profile?.kitPersona ? getKitPersona(profile.kitPersona) : null;
      if (!p) {
        return respond(
          { found: false, available: KIT_PERSONA_SLUGS },
          {
            summary: 'No saved kit yet — call set_my_kit.',
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'set_my_kit', arguments: { persona: 'indie-dev' }, reason: 'save your persona' }],
          },
        );
      }
      const kit = loadKit(p, (profile?.kitTier as KitTier | null) ?? p.defaultTier);
      return respond(kitPayload(kit), {
        summary: kitSummary(kit),
        economy: withUserEconomy(auth.userId, 'read'),
      });
    },
  );

  server.registerTool(
    'whats_changed',
    {
      description:
        'Kit picks that changed recently — which tool replaced which, per job, with when and why. Use for "what changed since I last looked" and to catch when something you committed to stopped being the pick.',
      inputSchema: {
        days: z.number().int().min(1).max(365).default(30),
        persona: z.string().optional().describe('limit to the cells in one persona kit — see list_kits'),
        limit: z.number().int().min(1).max(100).default(50),
      },
      outputSchema: {
        ...envelopeSchema,
        window_days: z.number(),
        count: z.number(),
        persona: z.string().nullable().optional(),
        changes: z.array(
          z.object({
            category: z.string(),
            task: z.string(),
            tier: z.string(),
            pick: z.string(),
            previous_pick: z.string().nullable(),
            reason: z.string(),
            changed_at: z.string(),
          }),
        ),
      },
    },
    async ({ days, persona, limit }) => {
      const p = persona ? getKitPersona(persona) : null;
      const rows = loadKitPickHistory({
        days,
        cells: p?.routes ?? null,
        limit,
      });

      return respond(
        {
          window_days: days,
          persona: p?.slug ?? null,
          count: rows.length,
          changes: rows.map((r) => ({
            category: r.category,
            task: r.task,
            tier: r.tier,
            pick: r.toPick,
            previous_pick: r.fromPick ?? null,
            reason: r.reason,
            changed_at: r.changedAt.toISOString(),
          })),
        },
        {
          summary:
            rows.length === 0
              ? `No kit changes in the last ${days} days${p ? ` for ${p.label}` : ''}.`
              : `${rows.length} kit change(s) in the last ${days} days${p ? ` for ${p.label}` : ''}.`,
          economy: withUserEconomy(auth.userId, 'read'),
          next: p
            ? [{ tool: 'get_kit', arguments: { persona: p.slug }, reason: 'see the current kit' }]
            : [{ tool: 'list_kits', arguments: {}, reason: 'pick a persona to filter by' }],
        },
      );
    },
  );
}
