import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/user';
import { config } from '@/lib/config';
import { MAX_OAUTH_INPUT_LEN, revokeUserClient } from '@/lib/oauth';

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
 * User-facing disconnect (called by the /oauth/connections page): drops every
 * grant the signed-in user issued to one client. Distinct from
 * /api/oauth/revoke (RFC 7009), which is the agent's own unauthenticated path.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'login required' }, { status: 401 });

  // same CSRF idiom as /api/oauth/authorize: the SameSite=lax cookie already
  // blocks cross-site sends; reject explicitly cross-site metadata when present
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }

  const body = await parseBody(req);
  const formPost = (req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded');
  const clientId = body.client_id;
  if (typeof clientId !== 'string' || !clientId || clientId.length > MAX_OAUTH_INPUT_LEN) {
    return NextResponse.json({ error: 'invalid client_id' }, { status: 400 });
  }

  const revoked = revokeUserClient(user.id, clientId);
  if (formPost) {
    return NextResponse.redirect(new URL('/oauth/connections', config.siteUrl), 303);
  }
  return NextResponse.json(
    { ok: true, revoked },
    { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
  );
}
