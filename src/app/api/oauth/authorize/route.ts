import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/user';
import { oauthCompleteLanding } from '@/lib/oauth-loopback';
import { config } from '@/lib/config';
import { createCode, getClient, MAX_OAUTH_INPUT_LEN, sanitizeScopes } from '@/lib/oauth';

async function parseBody(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    const text = await req.text();
    const out: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(text)) out[k] = v;
    return out;
  }
  try {
    const json = (await req.json()) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(json)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Consent confirmation (called by the authorize page's Allow button):
 * re-validates the request server-side and issues the authorization code.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });

  // defense-in-depth CSRF check: the SameSite=lax cookie already blocks
  // cross-site sends; reject explicitly cross-site fetch metadata when present
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }

  let body: Record<string, string>;
  try {
    body = await parseBody(req);
  } catch {
    return NextResponse.json({ error: 'bad request body' }, { status: 400 });
  }
  const { client_id, redirect_uri, code_challenge, code_challenge_method, scope, state } = body;
  const formPost = (req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded');

  const client = typeof client_id === 'string' ? getClient(client_id) : null;
  if (!client) return NextResponse.json({ error: 'unknown client' }, { status: 400 });
  if (typeof redirect_uri !== 'string' || !client.redirectUris.includes(redirect_uri)) {
    return NextResponse.json({ error: 'redirect_uri not registered' }, { status: 400 });
  }
  if (typeof code_challenge !== 'string' || code_challenge.length < 43 || code_challenge.length > MAX_OAUTH_INPUT_LEN) {
    return NextResponse.json({ error: 'invalid code_challenge' }, { status: 400 });
  }
  if (code_challenge_method !== 'S256') {
    return NextResponse.json({ error: 'code_challenge_method must be S256' }, { status: 400 });
  }
  if (typeof state === 'string' && state.length > MAX_OAUTH_INPUT_LEN) {
    return NextResponse.json({ error: 'invalid state' }, { status: 400 });
  }

  const code = createCode({
    clientId: client.clientId,
    userId: user.id,
    redirectUri: redirect_uri,
    scope: sanitizeScopes(typeof scope === 'string' ? scope : ''),
    codeChallenge: code_challenge,
  });

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (typeof state === 'string' && state) url.searchParams.set('state', state);
  const landing = oauthCompleteLanding(url.toString(), config.siteUrl);
  if (formPost) {
    return NextResponse.redirect(landing, 302);
  }
  return NextResponse.json(
    { redirect: landing },
    { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
  );
}
