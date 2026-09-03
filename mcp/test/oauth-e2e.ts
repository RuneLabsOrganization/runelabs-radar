/**
 * End-to-end OAuth + hub browser test (Playwright, headless Chromium).
 *
 * Covers: hub pages render, the full OAuth 2.1 flow (DCR → authorize → login
 * redirect → consent → code → PKCE token exchange → authenticated MCP call),
 * the deny path, invalid-request guards, code single-use, refresh rotation,
 * and the 'plans' scope gate on generate_plan.
 *
 * Prereqs: web on :3000 (npm start), auth-enabled MCP on :3125, seeded admin
 * mcptest. Usage: npx tsx mcp/test/oauth-e2e.ts
 *
 * Env overrides (current values are the defaults, so the script runs as-is on
 * the machine it was written on):
 *   MCP_TEST_PASSWORD         — password of the seeded mcptest admin
 *   PLAYWRIGHT_CHROMIUM_PATH  — chromium (headless shell) executable
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const WEB = 'http://127.0.0.1:3000';
const MCP = 'http://127.0.0.1:3125';
const USER = 'mcptest';
const PASS = process.env.MCP_TEST_PASSWORD ?? 'McpT3st!Pass';
const CB_PORT = 9877;
const REDIRECT = `http://127.0.0.1:${CB_PORT}/callback`;
// pinned to the chromium revision present on this machine (playwright-core
// otherwise demands its own exact build); override via PLAYWRIGHT_CHROMIUM_PATH
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  process.env.LOCALAPPDATA + '\\ms-playwright\\chromium_headless_shell-1208\\chrome-headless-shell-win64\\chrome-headless-shell.exe';

let passed = 0;
const failures: string[] = [];
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function pkce() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// captures the browser redirect back from the authorize flow
const callbacks: URL[] = [];
const callbackServer = createServer((req, res) => {
  callbacks.push(new URL(req.url ?? '/', `http://127.0.0.1:${CB_PORT}`));
  res.writeHead(200, { 'content-type': 'text/plain' }).end('callback received');
});

async function mcpCall(token: string | null, method: string, params: unknown = {}) {
  const res = await fetch(`${MCP}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  const dataLine = text.trim().startsWith('event:')
    ? text.split('\n').filter((l) => l.startsWith('data:')).pop()?.slice(5)
    : text;
  return { status: res.status, challenge: res.headers.get('www-authenticate'), body: dataLine ? JSON.parse(dataLine) : null };
}

interface Grant {
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_in: number;
}

async function tokenRequest(form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${WEB}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function main() {
  await new Promise<void>((resolve) => callbackServer.listen(CB_PORT, () => resolve()));

  // ---------- part A: hub pages render (public mode) ----------
  console.log('== hub pages ==');
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  for (const [path, marker, waitSel] of [
    ['/', 'runelabs', ''],
    ['/opportunities', 'pportunit', ''],
    ['/board', '', ''],
    ['/stacks', '', ''],
    ['/brief', '', ''],
    ['/login', 'sign in', '#email'],
  ] as const) {
    const res = await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' });
    if (waitSel) await page.waitForSelector(waitSel, { timeout: 8000 }).catch(() => {});
    // innerText reflects CSS text-transform — compare case-insensitively
    const bodyText = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    check(`GET ${path}`, res?.status() === 200 && (marker === '' || bodyText.includes(marker)), `status=${res?.status()}`);
  }

  // ---------- part B: OAuth happy path ----------
  console.log('== oauth: registration + authorize + consent ==');
  const dcr = await fetch(`${WEB}/api/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'e2e-agent', redirect_uris: [REDIRECT] }),
  });
  const client = (await dcr.json()) as { client_id: string };
  check('dynamic client registration', dcr.status === 201 && typeof client.client_id === 'string', `status=${dcr.status}`);

  const { verifier, challenge } = pkce();
  const authorizeUrl =
    `${WEB}/oauth/authorize?response_type=code&client_id=${client.client_id}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}` +
    `&code_challenge_method=S256&scope=${encodeURIComponent('read plans')}&state=e2e-state-123`;

  await page.goto(authorizeUrl, { waitUntil: 'domcontentloaded' });
  check('authorize redirects to login when signed out', page.url().includes('/login?next='), page.url());

  await page.fill('#email', USER);
  await page.fill('#password', PASS);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/oauth\/authorize/, { timeout: 10000 });
  const consentText = (await page.evaluate(() => document.body.innerText)).toLowerCase();
  check('login returns to consent screen', consentText.includes('e2e-agent') && consentText.includes('mcp authorization'));
  check('consent lists both scopes', consentText.includes('read') && consentText.includes('plans'));

  await page.click('text=Allow');
  await page.waitForURL(/localhost:9877|127\.0\.0\.1:9877/, { timeout: 15000 });
  const cb1 = callbacks.at(-1);
  const code = cb1?.searchParams.get('code') ?? '';
  check('redirect carries code + state', code.length > 20 && cb1?.searchParams.get('state') === 'e2e-state-123');

  console.log('== oauth: token exchange + authenticated MCP ==');
  const grantRes = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    client_id: client.client_id,
    code_verifier: verifier,
  });
  check('code exchange issues tokens', grantRes.status === 200 && typeof grantRes.body.access_token === 'string');
  const grant = grantRes.body as unknown as Grant;
  check('grant scope is read plans', grant.scope === 'read plans', grant.scope);

  const replay = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    client_id: client.client_id,
    code_verifier: verifier,
  });
  check('code is single-use (replay rejected)', replay.status === 400 && replay.body.error === 'invalid_grant');

  const wrongVerifier = await tokenRequest({
    grant_type: 'authorization_code',
    code: 'whatever',
    redirect_uri: REDIRECT,
    client_id: client.client_id,
    code_verifier: 'wrong-verifier-that-does-not-match-anything-at-all',
  });
  check('bogus code rejected', wrongVerifier.status === 400);

  const noToken = await mcpCall(null, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '0' },
  });
  check('MCP 401 without token + challenge', noToken.status === 401 && (noToken.challenge ?? '').includes('oauth-protected-resource'));

  const badToken = await mcpCall('bogus-token', 'initialize', {});
  check('MCP 401 with bad token', badToken.status === 401);

  const init = await mcpCall(grant.access_token, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '0' },
  });
  check('MCP initialize with bearer', init.status === 200 && init.body?.result?.serverInfo?.name === 'runelabs-radar');

  const guide = await mcpCall(grant.access_token, 'tools/call', { name: 'get_server_guide', arguments: {} });
  const guideText = JSON.stringify(guide.body);
  check('MCP tool call with bearer', guide.status === 200 && guideText.includes('authenticated'), '');

  const market = await mcpCall(grant.access_token, 'tools/call', { name: 'get_market_models', arguments: { limit: 2 } });
  check('AA market data unlocked when authed', JSON.stringify(market.body).includes('"restricted":false'));

  console.log('== oauth: scope gate, deny path, refresh rotation, guards ==');
  // read-only token via a second consent pass (session cookie persists)
  const pk2 = pkce();
  await page.goto(
    `${WEB}/oauth/authorize?response_type=code&client_id=${client.client_id}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${pk2.challenge}` +
      `&code_challenge_method=S256&scope=read&state=s2`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.click('text=Allow');
  await page.waitForURL(/localhost:9877|127\.0\.0\.1:9877/, { timeout: 15000 });
  const code2 = callbacks.at(-1)?.searchParams.get('code') ?? '';
  const grant2Res = await tokenRequest({
    grant_type: 'authorization_code',
    code: code2,
    redirect_uri: REDIRECT,
    client_id: client.client_id,
    code_verifier: pk2.verifier,
  });
  const grant2 = grant2Res.body as unknown as Grant;
  check('second grant is read-only', grant2.scope === 'read', grant2.scope);
  const planAttempt = await mcpCall(grant2.access_token, 'tools/call', {
    name: 'generate_plan',
    arguments: { opportunity: 'whatever' },
  });
  check(
    "generate_plan blocked without 'plans' scope",
    JSON.stringify(planAttempt.body).includes("lacks the 'plans' scope"),
  );

  // deny path
  const pk3 = pkce();
  await page.goto(
    `${WEB}/oauth/authorize?response_type=code&client_id=${client.client_id}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${pk3.challenge}` +
      `&code_challenge_method=S256&scope=read&state=deny-state`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.click('text=Deny');
  await page.waitForURL(/localhost:9877|127\.0\.0\.1:9877/, { timeout: 10000 });
  const cbDeny = callbacks.at(-1);
  check(
    'deny redirects with access_denied + state',
    cbDeny?.searchParams.get('error') === 'access_denied' && cbDeny?.searchParams.get('state') === 'deny-state',
  );

  // refresh rotation
  const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: grant.refresh_token });
  check('refresh rotates the grant', refreshed.status === 200 && typeof refreshed.body.access_token === 'string');
  const oldRefresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: grant.refresh_token });
  check('old refresh token is dead', oldRefresh.status === 400);
  const oldAccess = await mcpCall(grant.access_token, 'initialize', {});
  check('old access token is dead after rotation', oldAccess.status === 401);

  // invalid authorize requests never redirect
  for (const [label, url] of [
    ['unknown client_id', `${WEB}/oauth/authorize?response_type=code&client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&state=x`],
    ['unregistered redirect_uri', `${WEB}/oauth/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent('http://evil.example.com/cb')}&code_challenge=${challenge}&state=x`],
    ['plain PKCE method', `${WEB}/oauth/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=plain&state=x`],
    ['bad response_type', `${WEB}/oauth/authorize?response_type=token&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&state=x`],
  ] as const) {
    const before = callbacks.length;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const errText = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    check(`guard: ${label}`, errText.includes('rejected') && callbacks.length === before);
  }

  check('no page JS errors across the whole run', consoleErrors.length === 0, consoleErrors[0] ?? '');

  await browser.close();
  callbackServer.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log('failures:', failures.join(' | '));
    process.exit(1);
  }
  console.log('OAUTH E2E OK');
  process.exit(0);
}

main().catch((e) => {
  console.error('E2E FAILED:', e);
  process.exit(1);
});
