import type { IncomingMessage } from 'node:http';
import { config } from '../../src/lib/config';
import { validateAccessToken } from '../../src/lib/oauth';

/**
 * Request authentication for the MCP endpoint. Two modes:
 *
 * - MCP_AUTH_REQUIRED=true (hosted): every /mcp call needs a valid bearer
 *   token issued by the hub's OAuth 2.1 flow; scopes gate what the token
 *   may do ('read' everywhere, 'plans' for plan generation, 'batches' for
 *   batch writes/runs).
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

/**
 * Scope gate for tool handlers — the generate_plan check, generalized.
 * Anonymous self-host contexts hold every scope (see authenticate), so this
 * only denies OAuth tokens that were minted without the scope.
 */
export function hasScope(auth: AuthContext, scope: string): boolean {
  return auth.scopes.has(scope);
}

/**
 * Fail-fast startup check: in production the 401 challenge MUST be built
 * from a configured public URL — without one it would be derived from the
 * unvalidated Host header, which is attacker-controlled. Dev falls back to
 * the loopback-validated Host (see resourceMetadataOrigin).
 */
export function assertPublicUrl(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.MCP_PUBLIC_URL) {
    throw new Error(
      'MCP_PUBLIC_URL is required when NODE_ENV=production — ' +
        'the 401 challenge builds resource_metadata URLs from it.',
    );
  }
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
    scopes: new Set(['read', 'plans', 'batches']),
    rateKey: `ip:${ip}`,
  };
}

/**
 * RFC 9728 challenge header value pointing agents at THIS server's
 * protected-resource metadata. The metadata lives on the resource server
 * (this process), not the authorization server.
 */
export function wwwAuthenticate(req: Pick<IncomingMessage, 'headers'>): string {
  return `Bearer resource_metadata="${resourceMetadataOrigin(req)}/.well-known/oauth-protected-resource"`;
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Origin for the metadata URL in the challenge. MCP_PUBLIC_URL always wins.
 * The Host-header fallback (dev only — assertPublicUrl guards production) is
 * trusted only when it is loopback, i.e. a direct hit on this machine; any
 * other Host is attacker-controlled and falls back to the configured site
 * URL rather than being reflected into a security header.
 */
export function resourceMetadataOrigin(req: Pick<IncomingMessage, 'headers'>): string {
  if (process.env.MCP_PUBLIC_URL) {
    return new URL(mcpPublicUrl()).origin;
  }
  const host = req.headers.host ?? 'localhost';
  try {
    if (LOOPBACK_HOSTNAMES.has(new URL(`http://${host}`).hostname)) {
      const proto = req.headers['x-forwarded-proto'] ?? 'http';
      return `${proto}://${host}`;
    }
  } catch {
    /* malformed Host — fall through to the safe default */
  }
  return new URL(mcpPublicUrl()).origin;
}
