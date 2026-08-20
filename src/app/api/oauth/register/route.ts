import { NextResponse } from 'next/server';
import { registerClient } from '@/lib/oauth';

/**
 * Dynamic Client Registration (RFC 7591) — MCP clients self-register on first
 * connect, so any agent can start the OAuth flow without pre-provisioned keys.
 * Public clients only: no secret is issued, PKCE is the proof.
 */

function isValidRedirectUri(u: string): boolean {
  if (u.length > 500) return false;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') {
    // loopback only — desktop agents' local callback servers
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  }
  // native custom schemes (cursor://, vscode://, …) — block the dangerous ones
  return !['javascript:', 'data:', 'file:', 'vbscript:'].includes(url.protocol);
}

// open registration needs a throttle: 20 registrations/hour per IP
const registrations = new Map<string, { count: number; resetAt: number }>();
// GC: sweep expired buckets so a flood of spoofed keys can't grow it forever
setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of registrations) if (r.resetAt < now) registrations.delete(ip);
}, 600e3).unref();
function registrationThrottled(ip: string): boolean {
  const now = Date.now();
  const rec = registrations.get(ip);
  if (!rec || rec.resetAt < now) {
    registrations.set(ip, { count: 1, resetAt: now + 36e5 });
    return false;
  }
  rec.count += 1;
  return rec.count > 20;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

export async function POST(req: Request) {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',').pop()!.trim() : 'local';
  if (registrationThrottled(ip)) {
    return NextResponse.json({ error: 'temporarily_throttled' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris
        .filter((u): u is string => typeof u === 'string')
        .filter(isValidRedirectUri)
        .slice(0, 10)
    : [];
  if (redirectUris.length === 0) {
    return NextResponse.json(
      { error: 'invalid_client_metadata', error_description: 'at least one valid redirect_uris entry is required' },
      { status: 400 },
    );
  }
  const name =
    typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 120) : null;
  const client = registerClient(name, redirectUris);
  return NextResponse.json(
    {
      client_id: client.clientId,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    { status: 201, headers: { 'access-control-allow-origin': '*' } },
  );
}
