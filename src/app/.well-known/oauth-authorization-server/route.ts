import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

/**
 * OAuth Authorization Server Metadata (RFC 8414) — how MCP clients discover
 * the endpoints. The hub is the authorization server; the MCP endpoint
 * (resource server) points here from its own protected-resource metadata.
 */
export async function GET() {
  const issuer = (process.env.OAUTH_ISSUER ?? config.siteUrl).replace(/\/+$/, '');
  return NextResponse.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      registration_endpoint: `${issuer}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['read', 'plans'],
      token_endpoint_auth_methods_supported: ['none'],
    },
    { headers: { 'access-control-allow-origin': '*' } },
  );
}
