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
import { assertPublicUrl, authenticate, issuerUrl, mcpPublicUrl, wwwAuthenticate } from './lib/auth';
import { buildServer } from './build';
import { contained, installProcessGuards } from './lib/contain';
import { isAllowedOrigin } from './lib/origin';
import { rateLimited, rateLimitPerHour } from './lib/rate';
import { gcCounters } from '../src/lib/usage/counters';

loadDotEnv();
assertPublicUrl();
installProcessGuards();

const PORT = Number(process.env.MCP_PORT ?? 3122);

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // DNS-rebinding guard (MCP spec: validate Origin on every request). In
  // anonymous mode there is no bearer to check, so without this any webpage
  // could POST here and burn the machine's anonymous LLM/rate budget — CORS
  // reflection below only hides the response, the request still runs. Token
  // mode instead answers bad/missing bearers with the 401 challenge, so its
  // CORS stays open to browser clients on any origin.
  if (process.env.MCP_AUTH_REQUIRED !== 'true' && !isAllowedOrigin(req.headers.origin, process.env.MCP_PUBLIC_URL)) {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden origin' }));
    return;
  }

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

  let limited = false;
  try {
    limited = rateLimited(auth.rateKey);
  } catch {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'rate limiter unavailable' }));
    return;
  }
  if (limited) {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'rate limit exceeded', limit_per_hour: rateLimitPerHour() }));
    return;
  }

  // Stateless mode: one server+transport per request, no session persistence.
  // contained(): a throwing handler gets a 500 JSON body, not a dead process.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer(auth);
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await contained(async () => {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }, res);
});

// prune expired counter rows hourly; unref so it never holds the process open
setInterval(() => {
  try {
    gcCounters();
  } catch {
    /* best-effort — a failed GC must never take the server down */
  }
}, 36e5).unref();

httpServer.listen(PORT, () => {
  console.log(
    `[mcp] ${getIdentity().productName} MCP server on :${PORT} (POST /mcp, GET /health, auth ${
      process.env.MCP_AUTH_REQUIRED === 'true' ? 'required' : 'anonymous'
    })`,
  );
});
