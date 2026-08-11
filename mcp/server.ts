/**
 * Runelabs Radar — MCP server (Streamable HTTP).
 *
 * Read-only window into the intelligence database for AI agents: daily
 * brief, top signals, best-right-now board, stack playbooks, opportunities.
 * Every payload carries attribution links back to the hub — the MCP server
 * is a distribution channel for the site, not a replacement.
 *
 * Run: npm run mcp   (env: MCP_PORT default 3122, DATABASE_PATH, SITE_URL)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { and, desc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { loadDotEnv } from '../src/lib/env';
import { config } from '../src/lib/config';
import { getIdentity } from '../src/lib/identity';
import { openReadonlyDb } from '../src/lib/db/readonly';
import { boardEntries, briefs, opportunities, stacks, stories } from '../src/lib/db/schema';
import { DOMAINS } from '../src/lib/domains';

loadDotEnv();

const PORT = Number(process.env.MCP_PORT ?? 3122);
const RATE_LIMIT_PER_HOUR = Number(process.env.MCP_RATE_LIMIT ?? 60);

// --- rate limiting: fixed window per IP, in-memory (single process) ---
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + 36e5 });
    return false;
  }
  b.count += 1;
  return b.count > RATE_LIMIT_PER_HOUR;
}
// GC the bucket map so a flood of unique IPs can't grow it forever
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) if (b.resetAt < now) buckets.delete(ip);
}, 600e3).unref();

function attribution(): string {
  const id = getIdentity();
  return `\n\n—\nSource: ${id.productName} · ${config.siteUrl}`;
}

function json(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) + attribution() }] };
}

function parseScores(json: string | null): Record<string, number> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, number>;
  } catch {
    return {};
  }
}

const domainEnum = z.enum(DOMAINS).optional();

function buildServer(): McpServer {
  const db = openReadonlyDb();
  const id = getIdentity();
  const server = new McpServer({
    name: 'runelabs-radar',
    version: '0.1.0',
  });

  server.registerTool(
    'get_daily_brief',
    {
      description: `The daily AI intelligence brief from ${id.productName} (top stories, why they matter, board changes). Returns markdown.`,
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD; default: latest') },
    },
    async ({ date }) => {
      const row = date
        ? db.select().from(briefs).where(eq(briefs.date, date)).get()
        : db.select().from(briefs).orderBy(desc(briefs.date)).limit(1).get();
      if (!row) return { content: [{ type: 'text' as const, text: `No brief found${date ? ` for ${date}` : ''}.` }] };
      return { content: [{ type: 'text' as const, text: row.markdown + attribution() }] };
    },
  );

  server.registerTool(
    'get_top_signals',
    {
      description:
        'Top curated AI stories on the scope right now, scored 0-100 per domain (coding, copy, image, video, ads, agentic). Use for "what happened in AI today/this week" questions.',
      inputSchema: {
        domain: domainEnum.describe('filter to a domain'),
        limit: z.number().int().min(1).max(25).default(10),
        hours: z.number().int().min(1).max(720).default(72).describe('lookback window'),
      },
    },
    async ({ domain, limit, hours }) => {
      const rows = db
        .select()
        .from(stories)
        .where(
          and(eq(stories.status, 'curated'), gt(stories.createdAt, new Date(Date.now() - hours * 36e5))),
        )
        .orderBy(desc(stories.topScore))
        .limit(200)
        .all();
      const filtered = rows
        .map((s) => ({ s, scores: parseScores(s.domainScores) }))
        .filter((x) => !domain || (x.scores[domain] ?? 0) >= 40)
        .slice(0, limit)
        .map(({ s, scores }) => ({
          title: s.title,
          score: domain ? (scores[domain] ?? 0) : s.topScore,
          tldr: s.tldr,
          why_it_matters: s.whyItMatters,
          created_at: s.createdAt.toISOString(),
          url: `${config.siteUrl}/story/${s.id}`,
        }));
      return json({ window_hours: hours, domain: domain ?? 'all', count: filtered.length, signals: filtered });
    },
  );

  server.registerTool(
    'get_best_right_now',
    {
      description:
        'The cost-benefit board: best overall / best value / cheapest viable AI model or tool per task in a domain, with cost notes and human verdicts. Weekly-synced. Use for "what should I use for X" questions.',
      inputSchema: { domain: domainEnum.describe('domain; omit for all domains') },
    },
    async ({ domain }) => {
      const rows = db
        .select()
        .from(boardEntries)
        .where(domain ? eq(boardEntries.domain, domain) : undefined)
        .orderBy(boardEntries.domain, boardEntries.task)
        .all();
      return json({
        count: rows.length,
        board: rows.map((r) => ({
          domain: r.domain,
          task: r.task,
          best_overall: r.bestOverall,
          best_value: r.bestValue,
          cheapest_viable: r.cheapestViable,
          cost_note: r.costNote,
          verdict: r.runelabsVerdict,
          updated_at: r.updatedAt?.toISOString(),
        })),
      });
    },
  );

  server.registerTool(
    'get_stack_for',
    {
      description:
        'The ship-it-today tech stack playbook for a venture type (layers: pick, alternative, cost note). Use for "what stack should I build X with" questions.',
      inputSchema: { venture: z.string().describe('venture slug, e.g. saas-b2b, ai-product, mobile-app') },
    },
    async ({ venture }) => {
      const row = db.select().from(stacks).where(eq(stacks.venture, venture)).get();
      if (!row) {
        const available = db.select({ v: stacks.venture }).from(stacks).all().map((r) => r.v);
        return { content: [{ type: 'text' as const, text: `No playbook for "${venture}". Available: ${available.join(', ') || '(none yet)'}` }] };
      }
      let layers: unknown = [];
      try {
        layers = JSON.parse(row.layers);
      } catch {
        /* leave as [] */
      }
      return json({
        venture: row.venture,
        title: row.title,
        tagline: row.tagline,
        time_to_mvp: row.timeToMvp,
        run_cost: row.costNote,
        layers,
        rationale: row.rationale,
        updated_at: row.updatedAt?.toISOString(),
      });
    },
  );

  server.registerTool(
    'get_opportunities',
    {
      description:
        'Monetizable business openings detected from the intelligence stream (unmet pains, newly-cheap capability, launch gaps), flip/hold scored. Use for "what should I build" questions.',
      inputSchema: { limit: z.number().int().min(1).max(10).default(5) },
    },
    async ({ limit }) => {
      const rows = db
        .select()
        .from(opportunities)
        .where(eq(opportunities.status, 'active'))
        .orderBy(desc(opportunities.flipScore))
        .limit(limit)
        .all();
      return json({
        count: rows.length,
        opportunities: rows.map((o) => ({
          title: o.title,
          sector: o.sector,
          window: o.window,
          flip_score: o.flipScore,
          hold_score: o.holdScore,
          thesis: o.thesis,
          first_seen: o.firstSeenAt.toISOString(),
          url: `${config.siteUrl}/opportunities`,
        })),
      });
    },
  );

  return server;
}

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'runelabs-radar-mcp' }));
    return;
  }

  if (url.pathname !== '/mcp') {
    res.writeHead(404).end('not found — MCP endpoint is POST /mcp');
    return;
  }

  const ip = req.socket.remoteAddress ?? 'unknown';
  if (rateLimited(ip)) {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'rate limit exceeded', limit_per_hour: RATE_LIMIT_PER_HOUR }));
    return;
  }

  // Stateless mode: one server+transport per request, no session persistence.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer();
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

httpServer.listen(PORT, () => {
  console.log(`[mcp] ${getIdentity().productName} MCP server on :${PORT} (POST /mcp, GET /health)`);
});
