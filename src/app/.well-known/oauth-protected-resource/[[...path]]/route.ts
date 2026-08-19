import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

/**
 * OAuth Protected Resource Metadata (RFC 9728) for the MCP endpoint.
 *
 * Served by the hub because in the path-based deployment the reverse proxy
 * maps radar.example.com/mcp → the MCP container, so this well-known URL on
 * the hub domain is where MCP clients look. The MCP server also answers it on
 * its own origin (subdomain / direct-port deployments). Optional catch-all
 * covers the §3.1 path-suffixed form (…/oauth-protected-resource/mcp).
 */
export async function GET() {
  const resource = (process.env.MCP_PUBLIC_URL ?? `${config.siteUrl.replace(/\/+$/, '')}/mcp`).replace(/\/+$/, '');
  const issuer = (process.env.OAUTH_ISSUER ?? config.siteUrl).replace(/\/+$/, '');
  return NextResponse.json(
    {
      resource,
      authorization_servers: [issuer],
      scopes_supported: ['read', 'plans'],
      bearer_methods_supported: ['header'],
    },
    { headers: { 'access-control-allow-origin': '*' } },
  );
}
