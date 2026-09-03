import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../src/lib/db';
import {
  boardEntries,
  opportunities,
  painPoints,
  stories,
} from '../../src/lib/db/schema';
import { marketModels } from '../../src/lib/analytics';
import { can } from '../../src/lib/entitlements';
import { chatJSON } from '../../src/lib/llm/minimax';
import { estimateTokens } from '../../src/lib/mcp-economy';
import { getProfile, getSession, setSession } from '../../src/lib/personalization';
import { promptLine, stripCjkLeak } from '../../src/lib/prompt-hygiene';
import { urls } from '../../src/lib/urls';
import { bump, peek } from '../../src/lib/usage/counters';
import { envelopeSchema, hoursAgo, respond, withUserEconomy, type NextAction } from '../lib/payload';
import { marketVisible, type AuthContext } from '../lib/auth';
import { visibleTo } from '../../src/lib/opportunities/scope';

const ASK_DAILY_CAP = Number(process.env.MCP_ASK_DAILY_CAP ?? 10);

// Anonymous per-caller daily cap, persisted in usage_counters (scout pattern):
// a deploy or a second replica no longer grants a fresh allowance, and the
// nightly gcCounters sweep keeps stale keys from accumulating.
function askCapExceeded(key: string): boolean {
  return peek(key, 'ask', 'day') >= ASK_DAILY_CAP;
}
function recordAsk(key: string): void {
  bump(key, 'ask', 'day');
}

interface AskOut {
  answer: string;
  confidence: number;
  citations?: string[];
  next_tools?: { tool: string; reason: string }[];
}

interface CiteRef {
  label: string;
  url?: string;
}

function gatherGrounding(auth: AuthContext): { block: string; refs: CiteRef[] } {
  const db = getDb();
  const sections: string[] = [];
  const refs: CiteRef[] = [];

  const opps = db
    .select({
      slug: opportunities.slug,
      title: opportunities.title,
      flip: opportunities.flipScore,
      verdict: opportunities.verdict,
    })
    .from(opportunities)
    .where(and(eq(opportunities.status, 'active'), visibleTo(auth.userId)))
    .orderBy(desc(opportunities.flipScore))
    .limit(5)
    .all();
  if (opps.length > 0) {
    sections.push(
      '<opportunities>\n' +
        opps
          .map((o) => `- ${o.slug}: ${promptLine(o.title, 90)} (flip ${o.flip}, ${o.verdict})`)
          .join('\n') +
        '\n</opportunities>',
    );
    for (const o of opps) refs.push({ label: o.slug, url: urls.opportunity(o.slug) });
  }

  const recent = db
    .select({ id: stories.id, title: stories.title, tldr: stories.tldr, score: stories.topScore })
    .from(stories)
    .where(and(eq(stories.status, 'curated'), gte(stories.createdAt, hoursAgo(48))))
    .orderBy(desc(stories.topScore), desc(stories.createdAt))
    .limit(5)
    .all();
  if (recent.length > 0) {
    sections.push(
      '<stories-48h>\n' +
        recent
          .map((s) => `- [#${s.id}] ${promptLine(s.title, 100)}${s.tldr ? ` — ${promptLine(s.tldr, 120)}` : ''}`)
          .join('\n') +
        '\n</stories-48h>',
    );
    for (const s of recent) refs.push({ label: s.title, url: urls.story(s.id) });
  }

  const board = db.select().from(boardEntries).orderBy(boardEntries.domain, boardEntries.task).limit(8).all();
  if (board.length > 0) {
    sections.push(
      '<board>\n' +
        board
          .map(
            (b) =>
              `- [${b.domain}] ${promptLine(b.task, 60)} → overall=${promptLine(b.bestOverall ?? '—', 40)}, value=${promptLine(b.bestValue ?? '—', 40)}`,
          )
          .join('\n') +
        '\n</board>',
    );
    refs.push({ label: 'best-right-now board', url: urls.decide() });
  }

  const pains = db
    .select()
    .from(painPoints)
    .orderBy(desc(painPoints.intensity), desc(painPoints.lastSeenAt))
    .limit(5)
    .all();
  if (pains.length > 0) {
    sections.push(
      '<pains>\n' +
        pains.map((p) => `- (${p.intensity}x) ${promptLine(p.summary, 160)}`).join('\n') +
        '\n</pains>',
    );
  }

  if (marketVisible(auth)) {
    const market = marketModels();
    if (market) {
      const picks = market.models
        .filter((m) => m.intelligence >= 25 && m.price > 0)
        .sort((a, b) => b.intelligence / b.price - a.intelligence / a.price)
        .slice(0, 5);
      if (picks.length > 0) {
        sections.push(
          '<model-market>\n' +
            picks
              .map((m) => `- ${promptLine(m.name, 50)}: intel ${m.intelligence}, $${m.price}/1M`)
              .join('\n') +
            '\n</model-market>',
        );
        refs.push({ label: 'model market', url: urls.metrics() });
      }
    }
  }

  return {
    block: sections.length > 0 ? `<grounding>\n${sections.join('\n\n')}\n</grounding>` : '',
    refs,
  };
}

function mapCitations(raw: string[] | undefined, refs: CiteRef[]): CiteRef[] {
  if (!raw || raw.length === 0) return refs.slice(0, 5);
  return raw.slice(0, 8).map((c) => {
    const needle = c.toLowerCase();
    const hit = refs.find(
      (r) =>
        r.label.toLowerCase() === needle ||
        r.label.toLowerCase().includes(needle) ||
        needle.includes(r.label.toLowerCase()),
    );
    return hit ? { label: c, url: hit.url } : { label: c };
  });
}

export function registerAskTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'ask_radar',
    {
      description:
        'Natural-language question in → grounded brief out. Server-side orchestration so the coding agent does NOT call 8 tools. Metered as a synthesis artifact (feature ask).',
      inputSchema: {
        question: z.string().min(10).max(500).describe('the question to answer from live Radar intelligence'),
        project: z.string().max(400).optional().describe('optional context: what you are building'),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        answer: z.string().optional(),
        confidence: z.number().optional(),
        citations: z.array(z.object({ label: z.string(), url: z.string().optional() })),
      },
    },
    async ({ question, project }) => {
      if (auth.userId != null) {
        const gate = can({ id: auth.userId }, 'ask');
        if (!gate.ok) {
          const hint = gate.upgradeHint ? ` — ${gate.upgradeHint}` : '';
          return respond(
            { ok: false, error: gate.reason ?? `ask quota reached${hint}`, citations: [] },
            {
              summary: gate.reason ?? `Ask quota reached${hint}.`,
              economy: withUserEconomy(auth.userId, 'ask'),
              next: [{ tool: 'get_opportunities', arguments: { limit: 10 }, reason: 'browse openings without a synthesis ask' }],
            },
          );
        }
      } else if (askCapExceeded(auth.rateKey)) {
        return respond(
          {
            ok: false,
            error: `daily ask cap reached (${ASK_DAILY_CAP}) — resets tomorrow`,
            citations: [],
          },
          {
            summary: `Daily ask cap reached (${ASK_DAILY_CAP}).`,
            economy: withUserEconomy(auth.userId, 'ask'),
            next: [{ tool: 'get_opportunities', arguments: { limit: 10 }, reason: 'browse openings without a synthesis ask' }],
          },
        );
      }
      if (auth.userId == null) recordAsk(auth.rateKey);

      const grounding = gatherGrounding(auth);
      let personal = '';
      if (auth.userId != null) {
        const session = getSession(auth.userId);
        const profile = getProfile(auth.userId);
        if (session || profile) {
          personal =
            `<user-context>\n` +
            (project ? `project: ${promptLine(project, 400)}\n` : '') +
            (session?.lastProject ? `last_project: ${promptLine(session.lastProject, 200)}\n` : '') +
            (session?.lastOpportunity ? `last_opportunity: ${session.lastOpportunity}\n` : '') +
            (profile?.skills?.length ? `skills: ${profile.skills.slice(0, 10).join(', ')}\n` : '') +
            (profile?.interests?.length ? `interests: ${profile.interests.slice(0, 10).join(', ')}\n` : '') +
            `</user-context>`;
        } else if (project) {
          personal = `<user-context>\nproject: ${promptLine(project, 400)}\n</user-context>`;
        }
      } else if (project) {
        personal = `<user-context>\nproject: ${promptLine(project, 400)}\n</user-context>`;
      }

      const system =
        'You are Radar\'s synthesis brief. Answer ONLY from the provided grounding. ' +
        'Return JSON: {answer: string, confidence: number 0-100, citations: string[], next_tools: {tool: string, reason: string}[]}. ' +
        'citations should name grounding items (opportunity slugs, story titles, board, model names). Be concise and actionable.';

      const user =
        (personal ? personal + '\n\n' : '') +
        `<question>\n${promptLine(question, 500)}\n</question>` +
        (grounding.block ? `\n\n${grounding.block}` : '\n\n<grounding>\n(no live data)\n</grounding>');

      let out: AskOut;
      try {
        out = await chatJSON<AskOut>(system, user, { feature: 'ask', userId: auth.userId });
      } catch (e) {
        // provider errors carry internals (endpoints, keys, retry detail) —
        // log the real error server-side, answer with a stable message
        // (same mapping as the phase-3 /api/debates route)
        console.error('[mcp/ask_radar] synthesis call failed:', e);
        return respond(
          { ok: false, error: 'ask failed — try again shortly', citations: [] },
          { summary: 'Ask could not run — try again shortly.', economy: withUserEconomy(auth.userId, 'ask') },
        );
      }

      if (auth.userId != null && project) setSession(auth.userId, { lastProject: project });

      const answer = stripCjkLeak(typeof out.answer === 'string' ? out.answer : '').trim();
      const confidence = Math.max(0, Math.min(100, Math.round(Number(out.confidence) || 0)));
      const citations = mapCitations(out.citations, grounding.refs);
      const next: NextAction[] = (out.next_tools ?? [])
        .filter((t) => t && typeof t.tool === 'string')
        .slice(0, 4)
        .map((t) => ({ tool: t.tool, arguments: {}, reason: t.reason || 'follow-up' }));

      const payload = { ok: true, answer, confidence, citations };
      return respond(payload, {
        summary: `Ask brief (confidence ${confidence}): ${answer.slice(0, 160)}${answer.length > 160 ? '…' : ''}`,
        economy: withUserEconomy(auth.userId, 'ask', {
          fullTokens: estimateTokens(JSON.stringify({ ...payload, next_tools: out.next_tools }, null, 2)),
        }),
        next,
      });
    },
  );
}
