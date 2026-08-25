import { desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import { comps, launches, opportunities, painPoints } from '../../src/lib/db/schema';
import { marketModels } from '../../src/lib/analytics';
import { runDebate } from '../../src/lib/opportunities/critic';
import { promptLine } from '../../src/lib/prompt-hygiene';
import { envelopeSchema, respond, type NextAction, withUserEconomy } from '../lib/payload';
import type { AuthContext } from '../lib/auth';
import { can } from '../../src/lib/entitlements';
import { estimateTokens } from '../../src/lib/mcp-economy';

// --- per-caller daily cap (§9b): a debate costs 4 LLM calls and there is no
// cache to serve repeats from, so EVERY call counts — recorded at entry,
// which also stops N parallel calls from all passing the check first ---
const DEBATE_DAILY_CAP = Number(process.env.MCP_DEBATE_DAILY_CAP ?? 10);
const debateUsage = new Map<string, { date: string; count: number }>();
function debateCapExceeded(key: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const rec = debateUsage.get(key);
  return (rec?.date === today ? rec.count : 0) >= DEBATE_DAILY_CAP;
}
function recordDebate(key: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const rec = debateUsage.get(key);
  debateUsage.set(key, { date: today, count: (rec?.date === today ? rec.count : 0) + 1 });
}

// --- deterministic idea↔evidence matching: token overlap, no embeddings ---

const STOPWORDS = new Set(
  (
    'the a an and or of to in on for with that this it is are be was were i me my we our you your they them their ' +
    'as at by from so do does how what when where who why can could should would will not no new build make app ' +
    'tool tools platform product service ai saas software idea'
  ).split(' '),
);

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

/** Normalized overlap: |a∩b| / sqrt(|a|·|b|) — 0..1, favors shared rare tokens. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit / Math.sqrt(a.size * b.size);
}

interface Grounding {
  /** the text block passed into runDebate alongside the idea */
  block: string;
  /** human-readable list of the sources actually used (payload `grounding`) */
  used: string[];
  /** closest tracked opportunities (title+slug), best first */
  closest: { slug: string; title: string }[];
}

function buildGrounding(idea: string): Grounding {
  const db = getDb();
  const ideaTok = tokenSet(idea);
  const sections: string[] = [];
  const used: string[] = [];

  // sector pains: the sector is inferred from the best-matching pain; with no
  // match at all, fall back to the strongest pains across every sector
  const pains = db
    .select()
    .from(painPoints)
    .where(gte(painPoints.lastSeenAt, new Date(Date.now() - 14 * 864e5)))
    .orderBy(desc(painPoints.intensity), desc(painPoints.lastSeenAt))
    .limit(50)
    .all();
  if (pains.length > 0) {
    const scored = pains
      .map((p) => ({ p, score: overlap(ideaTok, tokenSet(p.summary)) }))
      .sort((a, b) => b.score - a.score || b.p.intensity - a.p.intensity);
    const sector = scored[0]!.score > 0 ? scored[0]!.p.sector : null;
    const chosen = (sector ? scored.filter((x) => x.p.sector === sector) : scored).slice(0, 6);
    sections.push(
      '<pains>\n' +
        chosen.map((x) => `- (seen ${x.p.intensity}x) ${promptLine(x.p.summary, 200)}`).join('\n') +
        '\n</pains>',
    );
    used.push(
      sector
        ? `${chosen.length} observed pains in the inferred sector "${sector}"`
        : `${chosen.length} strongest observed pains across sectors`,
    );
  }

  // money comps from the last 60 days
  const compRows = db
    .select()
    .from(comps)
    .where(gte(comps.createdAt, new Date(Date.now() - 60 * 864e5)))
    .orderBy(desc(comps.createdAt))
    .limit(6)
    .all();
  if (compRows.length > 0) {
    sections.push(
      '<comps>\n' +
        compRows
          .map(
            (c) =>
              `- [${c.kind}] ${promptLine(c.product, 80)}${c.amountUsd !== null ? ` — $${Math.round(c.amountUsd).toLocaleString('en-US')}` : ''}${c.note ? ` (${promptLine(c.note, 120)})` : ''}`,
          )
          .join('\n') +
        '\n</comps>',
    );
    used.push(`${compRows.length} money comps (exits/revenue) from the last 60d`);
  }

  // launch activity, last 7 days, grouped by category
  const launchRows = db
    .select({ category: launches.category, n: sql<number>`count(*)` })
    .from(launches)
    .where(gte(launches.launchedAt, new Date(Date.now() - 7 * 864e5)))
    .groupBy(launches.category)
    .all();
  if (launchRows.length > 0) {
    sections.push(
      '<launch-activity-7d>\n' +
        launchRows.map((r) => `- ${r.category ?? 'untagged'}: ${r.n} launches`).join('\n') +
        '\n</launch-activity-7d>',
    );
    used.push(
      `launch activity from the last 7d (${launchRows.reduce((n, r) => n + r.n, 0)} launches across ${launchRows.length} categories)`,
    );
  }

  // model-market value picks (intelligence per dollar)
  const market = marketModels();
  if (market) {
    const picks = market.models
      .filter((m) => m.intelligence >= 25 && m.price > 0)
      .sort((a, b) => b.intelligence / b.price - a.intelligence / a.price)
      .slice(0, 5);
    if (picks.length > 0) {
      sections.push(
        '<model-market>\n' +
          picks.map((m) => `- ${promptLine(m.name, 60)}: intelligence ${m.intelligence}, $${m.price}/1M blended`).join('\n') +
          '\n</model-market>',
      );
      used.push(`${picks.length} model-market value picks (intelligence per $)`);
    }
  }

  // closest tracked opportunities by token overlap on title+thesis
  const active = db.select().from(opportunities).where(eq(opportunities.status, 'active')).all();
  const closest = active
    .map((o) => ({ o, score: overlap(ideaTok, tokenSet(`${o.title} ${o.thesis}`)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => ({ slug: x.o.slug, title: x.o.title }));
  if (closest.length > 0) {
    sections.push(
      '<closest-opportunities>\n' +
        closest.map((c) => `- ${c.slug}: ${promptLine(c.title, 90)}`).join('\n') +
        '\n</closest-opportunities>',
    );
    used.push(`closest tracked opportunities: ${closest.map((c) => c.slug).join(', ')}`);
  }

  return {
    block: sections.length > 0 ? `<grounding>\n${sections.join('\n\n')}\n</grounding>` : '',
    used,
    closest,
  };
}

const transcriptSchema = z.array(
  z.object({
    role: z.enum(['advocate', 'skeptic', 'realist', 'judge']),
    text: z.string(),
  }),
);

export function registerDebateTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'debate_idea',
    {
      description:
        'Pressure-test YOUR product idea in a multi-role debate (advocate → skeptic → market realist → judge), grounded in the platform\'s live intelligence: observed pains, money comps, launch activity, the model market, and the closest detected opportunities. Returns the judge\'s verdict (pursue/watch/reject), confidence, kill risks, conditions to succeed, 2-3 strengthened variants. Pass verdict_only=true to skip the full transcript.',
      inputSchema: {
        idea: z.string().min(10).max(600).describe('the idea to pressure-test, in one or two sentences'),
        verdict_only: z
          .boolean()
          .default(false)
          .describe('if true, omit the full 4-role transcript (cheaper for your context window)'),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        verdict: z.enum(['pursue', 'watch', 'reject']).optional(),
        confidence: z.number().optional(),
        kill_risks: z.array(z.string()).optional(),
        conditions_to_succeed: z.array(z.string()).optional(),
        strengthened_variants: z.array(z.string()).optional(),
        transcript: transcriptSchema.optional(),
        grounding: z.array(z.string()).optional(),
      },
    },
    async ({ idea, verdict_only }) => {
      if (auth.userId != null) {
        const gate = can({ id: auth.userId }, 'debate');
        if (!gate.ok) {
          const hint = gate.upgradeHint ? ` — ${gate.upgradeHint}` : '';
          return respond(
            {
              ok: false,
              error:
                gate.reason ??
                `debate quota reached (${gate.used}/${gate.quota})${hint}`,
            },
            {
              summary: `Debate quota reached (${gate.used}/${gate.quota}, tier "${gate.tier}")${hint}.`,
              next: [
                {
                  tool: 'get_opportunities',
                  arguments: { limit: 10 },
                  reason: 'already-reviewed openings cost nothing to browse',
                },
              ],
            },
          );
        }
      } else if (debateCapExceeded(auth.rateKey)) {
        return respond(
          { ok: false, error: `daily debate cap reached (${DEBATE_DAILY_CAP}) — every debate is a fresh 4-call LLM run, so the cap resets tomorrow` },
          {
            summary: `Daily debate cap reached (${DEBATE_DAILY_CAP}).`,
            next: [
              {
                tool: 'get_opportunities',
                arguments: { limit: 10 },
                reason: 'already-reviewed openings cost nothing to browse',
              },
            ],
          },
        );
      }
      // anonymous flat cap: record at entry, before the LLM run
      if (auth.userId == null) recordDebate(auth.rateKey);

      const grounding = buildGrounding(idea);
      const ideaText =
        `<idea>\n${promptLine(idea, 600)}\n</idea>` + (grounding.block ? `\n\n${grounding.block}` : '');

      let result;
      try {
        result = await runDebate(null, ideaText);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return respond(
          { ok: false, error: `debate failed: ${msg}`, grounding: grounding.used },
          { summary: `The debate could not run: ${msg}.` },
        );
      }

      const next: NextAction[] = [];
      if (result.verdict !== 'pursue') {
        next.push({
          tool: 'scout_opportunities',
          arguments: {},
          reason: `verdict was "${result.verdict}" — scout a stronger opening fitted to your constraints`,
        });
      }
      if (grounding.closest[0]) {
        next.push({
          tool: 'generate_plan',
          arguments: { opportunity: grounding.closest[0].slug },
          reason: `an execution plan for the closest tracked opportunity "${grounding.closest[0].slug}"`,
        });
      }
      const fullPayload = {
        ok: true,
        verdict: result.verdict,
        confidence: result.confidence,
        kill_risks: result.killRisks,
        conditions_to_succeed: result.conditionsToSucceed,
        strengthened_variants: result.strengthenedVariants,
        transcript: result.transcript,
        grounding: grounding.used,
      };
      const compact = {
        ok: true,
        verdict: result.verdict,
        confidence: result.confidence,
        kill_risks: result.killRisks,
        conditions_to_succeed: result.conditionsToSucceed,
        strengthened_variants: result.strengthenedVariants,
        grounding: grounding.used,
        ...(verdict_only ? {} : { transcript: result.transcript }),
      };
      return respond(compact, {
        summary:
          `Debate verdict: ${result.verdict} (confidence ${result.confidence}) — ` +
          `${result.killRisks.length} kill risk${result.killRisks.length === 1 ? '' : 's'}, ` +
          `${result.strengthenedVariants.length} strengthened variant${result.strengthenedVariants.length === 1 ? '' : 's'}.`,
        economy: withUserEconomy(auth.userId, 'debate', {
          fullTokens: estimateTokens(JSON.stringify(fullPayload, null, 2)),
        }),
        next,
      });
    },
  );
}
