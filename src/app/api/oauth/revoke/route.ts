import { NextResponse } from 'next/server';
import { revokeToken } from '@/lib/oauth';

// RFC 7009 token revocation: public clients (MCP agents) hold no secret, so
// knowing the 256-bit token is itself the proof of possession. CORS is open
// for the same reason as the token endpoint.

const NO_STORE = {
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
  pragma: 'no-cache',
} as const;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
    },
  });
}

export async function POST(req: Request) {
  // RFC 7009 §2.2: always 200 — the response must not reveal whether the
  // submitted token existed, was already revoked, or was never valid.
  try {
    const form = await req.formData();
    const token = form.get('token');
    // token_type_hint is read-and-ignored: access and refresh tokens share a
    // row, so revoking either kills the pair.
    if (typeof token === 'string') revokeToken(token);
  } catch {
    /* fall through to the uniform 200 */
  }
  return new NextResponse(null, { status: 200, headers: NO_STORE });
}
