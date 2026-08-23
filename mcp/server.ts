/**
 * Runelabs Radar — MCP server (Streamable HTTP).
 *
 * The product surface for AI agents: the full intelligence database as tools
 * (signals, launches, board, stacks, opportunities, pains, patterns, topic
 * map, market, forecasts, accuracy, entities, comps), radar:// resources,
 * guided workflow prompts, and the flagship generate_plan flow (opportunity →
 * granular execution plan a local agent can run).
 *
 * Auth (OAuth 2.1, MCP spec): when MCP_AUTH_REQUIRED=true, /mcp requires a
 * bearer token issued by the hub; the hub (Next.js) is the authorization
 * server. Self-host default stays anonymous + IP rate-limited.
 *
 * Run: npm run mcp   (env: MCP_PORT default 3122, DATABASE_PATH, SITE_URL,
 *                      MCP_AUTH_REQUIRED, OAUTH_ISSUER, MCP_PUBLIC_URL)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadDotEnv } from '../src/lib/env';
import { getIdentity } from '../src/lib/identity';
import { urls } from '../src/lib/urls';
import { authenticate, issuerUrl, mcpPublicUrl, wwwAuthenticate } from './lib/auth';
import { buildServer } from './build';

loadDotEnv();

const PORT = Number(process.env.MCP_PORT ?? 3122);
const RATE_LIMIT_PER_HOUR = Number(process.env.MCP_RATE_LIMIT ?? 300);

// --- rate limiting: fixed window per bucket (token or IP), in-memory ---
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + 36e5 });
    return false;
  }
  b.count += 1;
  return b.count > RATE_LIMIT_PER_HOUR;
}
// GC the bucket map so a flood of unique keys can't grow it forever
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.resetAt < now) buckets.delete(key);
}, 600e3).unref();

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // CORS: browsers only. Token mode allows any origin (the bearer is the
  // credential); anonymous self-host mode reflects loopback origins only, so
  // arbitrary websites can't drive-by read a local instance.
  const origin = req.headers.origin ?? '';
  if (process.env.MCP_AUTH_REQUIRED === 'true') {
    res.setHeader('access-control-allow-origin', '*');
  } else if (origin) {
    try {
      const host = new URL(origin).hostname;
      if (['localhost', '127.0.0.1', '[::1]'].includes(host)) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
      }
    } catch {
      /* malformed Origin — no CORS headers */
    }
  }
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization, mcp-protocol-version, mcp-session-id');
  res.setHeader('access-control-expose-headers', 'mcp-session-id, www-authenticate');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'runelabs-radar-mcp' }));
    return;
  }

  // RFC 9728: where agents discover the authorization server for this resource
  // (exact form and the §3.1 path-suffixed form …/oauth-protected-resource/mcp)
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        resource: mcpPublicUrl(),
        authorization_servers: [issuerUrl()],
        scopes_supported: ['read', 'plans', 'batches'],
        bearer_methods_supported: ['header'],
      }),
    );
    return;
  }

  if (url.pathname !== '/mcp') {
    // humans get docs, agents get the JSON 404 below
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(302, { location: urls.connect() });
      res.end();
      return;
    }
    res.writeHead(404).end('not found — MCP endpoint is POST /mcp');
    return;
  }

  // a browser that wandered to /mcp gets the connect page; agents POST.
  // Never redirect anything that looks like an MCP client (auth header or
  // protocol version) — in token mode those need the 401 challenge instead.
  if (
    req.method === 'GET' &&
    (req.headers.accept ?? '').includes('text/html') &&
    !req.headers.authorization &&
    !req.headers['mcp-protocol-version']
  ) {
    res.writeHead(302, { location: urls.connect() });
    res.end();
    return;
  }

  const auth = authenticate(req);
  if (!auth) {
    res.writeHead(401, {
      'content-type': 'application/json',
      'www-authenticate': wwwAuthenticate(req),
    });
    res.end(JSON.stringify({ error: 'unauthorized', hint: `get a token at ${issuerUrl()}` }));
    return;
  }

  if (rateLimited(auth.rateKey)) {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'rate limit exceeded', limit_per_hour: RATE_LIMIT_PER_HOUR }));
    return;
  }

  // Stateless mode: one server+transport per request, no session persistence.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer(auth);
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

httpServer.listen(PORT, () => {
  console.log(
    `[mcp] ${getIdentity().productName} MCP server on :${PORT} (POST /mcp, GET /health, auth ${
      process.env.MCP_AUTH_REQUIRED === 'true' ? 'required' : 'anonymous'
    })`,
  );
});
