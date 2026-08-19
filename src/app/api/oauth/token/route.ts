import { NextResponse } from 'next/server';
import { exchangeCode, refreshGrant, type TokenGrant } from '@/lib/oauth';

// Token endpoint: public clients (MCP agents) with PKCE — no client secret.
// Browser-based MCP clients call this cross-origin, so CORS is open.

const NO_STORE = {
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
  pragma: 'no-cache',
} as const;

function grantResponse(grant: TokenGrant) {
  return NextResponse.json(
    {
      access_token: grant.accessToken,
      token_type: 'Bearer',
      expires_in: grant.expiresIn,
      refresh_token: grant.refreshToken,
      scope: grant.scope,
    },
    { headers: NO_STORE },
  );
}

function oauthError(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

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
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return oauthError('invalid_request');
  }
  const get = (k: string): string => {
    const v = form.get(k);
    return typeof v === 'string' ? v : '';
  };

  if (get('grant_type') === 'authorization_code') {
    const grant = exchangeCode(get('code'), get('redirect_uri'), get('code_verifier'), get('client_id'));
    return grant ? grantResponse(grant) : oauthError('invalid_grant');
  }

  if (get('grant_type') === 'refresh_token') {
    const grant = refreshGrant(get('refresh_token'));
    return grant ? grantResponse(grant) : oauthError('invalid_grant');
  }

  return oauthError('unsupported_grant_type');
}
