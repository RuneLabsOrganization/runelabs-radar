import type { IncomingMessage } from 'node:http';
import { config } from '../../src/lib/config';
import { validateAccessToken } from '../../src/lib/oauth';

/**
 * Request authentication for the MCP endpoint. Two modes:
 *
 * - MCP_AUTH_REQUIRED=true (hosted): every /mcp call needs a valid bearer
 *   token issued by the hub's OAuth 2.1 flow; scopes gate what the token
 *   may do ('read' everywhere, 'plans' for plan generation).
 * - MCP_AUTH_REQUIRED unset/false (self-host default): anonymous full access,
 *   rate-limited per IP — today's behavior, unchanged.
 */
export interface AuthContext {
  authed: boolean;
  userId: number | null;
  scopes: Set<string>;
  /** Rate-limit bucket key: per-token when authed, per-IP otherwise. */
  rateKey: string;
}

export function authRequired(): boolean {
  return process.env.MCP_AUTH_REQUIRED === 'true';
}

/** Canonical URL of this MCP endpoint — used in the protected-resource metadata. */
export function mcpPublicUrl(): string {
  return process.env.MCP_PUBLIC_URL ?? `${config.siteUrl.replace(/\/+$/, '')}/mcp`;
}

/** The authorization server (the hub) that issues tokens. */
export function issuerUrl(): string {
  return (process.env.OAUTH_ISSUER ?? config.siteUrl).replace(/\/+$/, '');
}

/**
 * AA redistribution terms: market-price data goes only to authenticated
 * callers, or to everyone when the operator set AA_PUBLIC=true.
 */
export function marketVisible(auth: AuthContext): boolean {
  return auth.authed || config.aaPublic;
}

export function authenticate(req: IncomingMessage): AuthContext | null {
  const ip = req.socket.remoteAddress ?? 'unknown';
  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (bearer) {
    let grant = null;
    try {
      grant = validateAccessToken(bearer);
    } catch {
      // oauth tables not migrated yet — treat as invalid, not as a server error
      grant = null;
    }
    if (grant) {
      return {
        authed: true,
        userId: grant.userId,
        scopes: new Set(grant.scope.split(/\s+/).filter(Boolean)),
        // key on the stable user, not the token row: refresh rotation mints a
        // new row id, and a token-keyed limiter resets on every rotation
        rateKey: `user:${grant.userId}`,
      };
    }
    // invalid/expired bearer: hard 401 when auth is required; in anonymous
    // (self-host) mode fall back to the anonymous context instead of trapping
    // a client that holds a stale credential
    if (authRequired()) return null;
  } else if (authRequired()) {
    return null;
  }
  return {
    authed: false,
    userId: null,
    scopes: new Set(['read', 'plans']),
    rateKey: `ip:${ip}`,
  };
}

/**
 * RFC 9728 challenge header value pointing agents at THIS server's
 * protected-resource metadata. The metadata lives on the resource server
 * (this process), not the authorization server. Origin comes from
 * MCP_PUBLIC_URL when set, else from the request itself (reverse proxies set
 * x-forwarded-proto; direct self-host hits arrive on the loopback host).
 */
export function wwwAuthenticate(req: IncomingMessage): string {
  let origin: string;
  if (process.env.MCP_PUBLIC_URL) {
    origin = new URL(mcpPublicUrl()).origin;
  } else {
    const proto = req.headers['x-forwarded-proto'] ?? 'http';
    const host = req.headers.host ?? 'localhost';
    origin = `${proto}://${host}`;
  }
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
}
