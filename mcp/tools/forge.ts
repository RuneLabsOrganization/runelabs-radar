import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { opportunities } from '../../src/lib/db/schema';
import { forgeOpportunity } from '../../src/lib/opportunities/forge';
import { can } from '../../src/lib/entitlements';
import { envelopeSchema, respond, withUserEconomy } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

export function registerForgeTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'forge_opportunity',
    {
      description:
        'The deep pass: run a four-role adversarial debate (advocate, skeptic, realist, judge) against one opening, then re-score it through the deterministic gate. Returns kill risks, the conditions it would need to succeed, and stronger variants of the idea. Costs four LLM calls and consumes your monthly forge quota — call it deliberately, on an opening you are seriously considering, not on every result. Requires Builder or Factory.',
      inputSchema: {
        opportunity: z.string().describe('opportunity slug or numeric id'),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        flip_score: z.number().optional(),
        hold_score: z.number().optional(),
        verdict: z.string().optional(),
        confidence: z.number().optional(),
        kill_risks: z.array(z.string()).optional(),
        conditions_to_succeed: z.array(z.string()).optional(),
        strengthened_variants: z.array(z.string()).optional(),
      },
    },
    async ({ opportunity }) => {
      if (auth.userId == null) {
        return respond(
          { ok: false, error: 'Forging requires sign in.' },
          {
            summary: 'Sign in to run the adversarial deep pass.',
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'get_opportunities', arguments: { limit: 10 }, reason: 'browsing stays free' }],
          },
        );
      }

      // Gate BEFORE any lookup work, so a blocked caller never triggers spend.
      const gate = can({ id: auth.userId }, 'forge');
      if (!gate.ok) {
        const hint = gate.upgradeHint ? ` — ${gate.upgradeHint}` : '';
        return respond(
          { ok: false, error: `${gate.reason ?? 'forge unavailable'}${hint}` },
          {
            summary: `Forge unavailable on tier "${gate.tier}"${hint}.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [
              {
                tool: 'debate_idea',
                arguments: { idea: opportunity },
                reason: 'a lighter pressure-test that may fit your tier',
              },
            ],
          },
        );
      }

      const db = getDb();
      const asId = /^\d+$/.test(opportunity) ? Number(opportunity) : null;
      const scope = or(isNull(opportunities.ownerUserId), eq(opportunities.ownerUserId, auth.userId));
      const row = db
        .select({ id: opportunities.id, title: opportunities.title })
        .from(opportunities)
        .where(
          asId
            ? and(eq(opportunities.id, asId), scope)
            : and(eq(opportunities.slug, opportunity), scope),
        )
        .get();
      if (!row) {
        return respond(
          { ok: false, error: `No opportunity "${opportunity}" in your scope.` },
          {
            summary: `No opportunity "${opportunity}" available to you.`,
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'get_opportunities', arguments: { limit: 10 }, reason: 'list valid slugs' }],
          },
        );
      }

      const res = await forgeOpportunity(row.id, auth.userId);
      if (!res.ok) {
        return respond(
          { ok: false, error: res.error ?? 'forge failed' },
          {
            summary: `The forge could not complete: ${res.error ?? 'unknown error'}.`,
            economy: withUserEconomy(auth.userId, 'debate'),
          },
        );
      }

      return respond(
        {
          ok: true,
          flip_score: res.flipScore,
          hold_score: res.holdScore,
          verdict: res.verdict,
          confidence: res.confidence,
          kill_risks: res.killRisks ?? [],
          conditions_to_succeed: res.conditionsToSucceed ?? [],
          strengthened_variants: res.strengthenedVariants ?? [],
        },
        {
          summary: `"${row.title}" forged — verdict ${res.verdict} at ${res.confidence}% confidence, flip ${res.flipScore}/hold ${res.holdScore}. ${(res.killRisks ?? []).length} kill risk(s) named.`,
          economy: withUserEconomy(auth.userId, 'debate'),
          next: [
            {
              tool: 'generate_plan',
              arguments: { opportunity },
              reason: 'the opening survived review — turn it into an executable plan',
            },
          ],
        },
      );
    },
  );
}
