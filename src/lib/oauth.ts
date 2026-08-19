import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from './db';
import { oauthClients, oauthCodes, oauthTokens } from './db/schema';

/**
 * OAuth 2.1 backing store for the MCP server. Next.js is the authorization
 * server (authorize/register/token routes call into here); the MCP process
 * only reads (validateAccessToken). PKCE S256 is mandatory; clients register
 * dynamically (RFC 7591) so any MCP client can connect without copying keys.
 */

export const SCOPES = ['read', 'plans'] as const;
export type Scope = (typeof SCOPES)[number];

const CODE_TTL_MS = 5 * 60 * 1000; // authorization codes: 5 minutes
const ACCESS_TTL_MS = 24 * 36e5; // access tokens: 24 hours (clients refresh)
const REFRESH_TTL_MS = 180 * 864e5; // refresh chain: 180 days ABSOLUTE, from first issuance

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sanitizeScopes(scope: string | undefined | null): string {
  const requested = new Set((scope ?? '').split(/\s+/).filter(Boolean));
  // canonical SCOPES order, unknown scopes dropped — stable strings for storage
  const ok = SCOPES.filter((s) => requested.has(s));
  return ok.length > 0 ? ok.join(' ') : 'read';
}

// --- dynamic client registration (RFC 7591) ---

export interface ClientRow {
  clientId: string;
  name: string | null;
  redirectUris: string[];
}

function toClientRow(r: typeof oauthClients.$inferSelect): ClientRow {
  let uris: string[] = [];
  try {
    const parsed: unknown = JSON.parse(r.redirectUris);
    if (Array.isArray(parsed)) uris = parsed.filter((u): u is string => typeof u === 'string');
  } catch {
    /* keep [] */
  }
  return { clientId: r.clientId, name: r.name, redirectUris: uris };
}

export function registerClient(name: string | null, redirectUris: string[]): ClientRow {
  const db = getDb();
  const clientId = newToken();
  db.insert(oauthClients)
    .values({ clientId, name, redirectUris: JSON.stringify(redirectUris), createdAt: new Date() })
    .run();
  return { clientId, name, redirectUris };
}

export function getClient(clientId: string): ClientRow | null {
  const db = getDb();
  const row = db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).get();
  return row ? toClientRow(row) : null;
}

// --- authorization code flow with PKCE ---

export function createCode(input: {
  clientId: string;
  userId: number;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
}): string {
  const db = getDb();
  const code = newToken();
  db.insert(oauthCodes)
    .values({
      code,
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      scope: sanitizeScopes(input.scope),
      codeChallenge: input.codeChallenge,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      createdAt: new Date(),
    })
    .run();
  return code;
}

export interface TokenGrant {
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresIn: number; // seconds
}

function issueTokens(clientId: string, userId: number, scope: string, firstIssuedAt?: Date): TokenGrant {
  const db = getDb();
  const accessToken = newToken();
  const refreshToken = newToken();
  db.insert(oauthTokens)
    .values({
      accessToken,
      refreshToken,
      clientId,
      userId,
      scope,
      expiresAt: new Date(Date.now() + ACCESS_TTL_MS),
      // rotations keep the original issuance date, so the refresh chain hits
      // an absolute cap instead of sliding forward forever
      createdAt: firstIssuedAt ?? new Date(),
    })
    .run();
  return { accessToken, refreshToken, scope, expiresIn: ACCESS_TTL_MS / 1000 };
}

function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Exchange an authorization code for tokens; single-use, PKCE-verified, client-bound. */
export function exchangeCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  clientId: string,
): TokenGrant | null {
  const db = getDb();
  const row = db.select().from(oauthCodes).where(eq(oauthCodes.code, code)).get();
  if (!row) return null;
  // single-use: consume immediately so a leaked code can't be replayed later
  db.delete(oauthCodes).where(eq(oauthCodes.id, row.id)).run();
  if (row.expiresAt.getTime() < Date.now()) return null;
  if (row.redirectUri !== redirectUri) return null;
  if (row.clientId !== clientId) return null; // code was issued to a different client
  if (!pkceMatches(codeVerifier, row.codeChallenge)) return null;
  return issueTokens(row.clientId, row.userId, row.scope);
}

/** Rotate a refresh token: the old grant dies, a fresh pair is issued. */
export function refreshGrant(refreshToken: string): TokenGrant | null {
  const db = getDb();
  const row = db.select().from(oauthTokens).where(eq(oauthTokens.refreshToken, refreshToken)).get();
  if (!row) return null;
  db.delete(oauthTokens).where(eq(oauthTokens.id, row.id)).run();
  // absolute cap measured from FIRST issuance (createdAt carries across rotations)
  if (row.createdAt.getTime() + REFRESH_TTL_MS < Date.now()) return null;
  return issueTokens(row.clientId, row.userId, row.scope, row.createdAt);
}

// --- resource-server side ---

export interface AccessGrant {
  id: number;
  userId: number;
  scope: string;
}

/** Validate a bearer token for the MCP endpoint. Null when unknown/expired. */
export function validateAccessToken(accessToken: string): AccessGrant | null {
  const db = getDb();
  const row = db
    .select({ id: oauthTokens.id, userId: oauthTokens.userId, scope: oauthTokens.scope })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.accessToken, accessToken), gt(oauthTokens.expiresAt, new Date())))
    .get();
  return row ?? null;
}
