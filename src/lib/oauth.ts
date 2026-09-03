import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt, or } from 'drizzle-orm';
import { getDb } from './db';
import { oauthClients, oauthCodes, oauthTokens } from './db/schema';

/** Cap on attacker-controlled string inputs (code_challenge, state, verifier, …). */
export const MAX_OAUTH_INPUT_LEN = 512;

/**
 * OAuth 2.1 backing store for the MCP server. Next.js is the authorization
 * server (authorize/register/token routes call into here); the MCP process
 * only reads (validateAccessToken). PKCE S256 is mandatory; clients register
 * dynamically (RFC 7591) so any MCP client can connect without copying keys.
 */

export const SCOPES = ['read', 'plans', 'batches'] as const;
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

// --- revocation (RFC 7009) ---

/**
 * Revoke a grant by access OR refresh token; both live on the same row, so
 * deleting it kills the pair. Returns whether a row was removed — callers
 * answering the public RFC 7009 endpoint must ignore this and always return
 * 200 (the response must not reveal whether the token existed).
 */
export function revokeToken(token: string): boolean {
  if (!token || token.length > MAX_OAUTH_INPUT_LEN) return false;
  const db = getDb();
  const row = db
    .select()
    .from(oauthTokens)
    .where(or(eq(oauthTokens.accessToken, token), eq(oauthTokens.refreshToken, token)))
    .get();
  if (!row) return false;
  // Constant-time confirmation of the indexed lookup: fixed-length compare
  // before acting on the match.
  const t = Buffer.from(token);
  const matches =
    (row.accessToken.length === t.length && timingSafeEqual(Buffer.from(row.accessToken), t)) ||
    (!!row.refreshToken && row.refreshToken.length === t.length && timingSafeEqual(Buffer.from(row.refreshToken), t));
  if (!matches) return false;
  db.delete(oauthTokens).where(eq(oauthTokens.id, row.id)).run();
  return true;
}

export interface ClientConnection {
  clientId: string;
  clientName: string | null;
  scope: string;
  /** First issuance of the oldest live grant — when the chain started. */
  connectedAt: Date;
  /** Live grant rows (one per refresh chain the client holds). */
  grants: number;
}

/** The agents a user has live grants for, one entry per client. */
export function listUserConnections(userId: number): ClientConnection[] {
  const db = getDb();
  const rows = db
    .select({
      clientId: oauthTokens.clientId,
      scope: oauthTokens.scope,
      createdAt: oauthTokens.createdAt,
      clientName: oauthClients.name,
    })
    .from(oauthTokens)
    .leftJoin(oauthClients, eq(oauthClients.clientId, oauthTokens.clientId))
    .where(eq(oauthTokens.userId, userId))
    .all();
  const byClient = new Map<string, ClientConnection & { scopes: Set<string> }>();
  for (const r of rows) {
    let entry = byClient.get(r.clientId);
    if (!entry) {
      entry = {
        clientId: r.clientId,
        clientName: r.clientName,
        scope: '',
        connectedAt: r.createdAt,
        grants: 0,
        scopes: new Set(),
      };
      byClient.set(r.clientId, entry);
    }
    entry.grants += 1;
    if (r.createdAt < entry.connectedAt) entry.connectedAt = r.createdAt;
    for (const s of r.scope.split(/\s+/).filter(Boolean)) entry.scopes.add(s);
  }
  return [...byClient.values()]
    .map(({ scopes, ...rest }) => ({ ...rest, scope: [...scopes].join(' ') }))
    .sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime());
}

/** Disconnect one agent: drop every grant this user issued to the client. */
export function revokeUserClient(userId: number, clientId: string): number {
  const db = getDb();
  return db
    .delete(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.clientId, clientId)))
    .run().changes;
}

/**
 * Daily-sweep hook: drop codes and token rows that can never be used again.
 * Codes die at expiresAt (5-minute TTL). Token rows are NOT swept at
 * expiresAt — that is the 24h access-token expiry, but the row also carries
 * the refresh chain, so a row is dead only once the chain's absolute cap
 * (REFRESH_TTL_MS from first issuance, see refreshGrant) has passed.
 */
export function sweepExpiredOAuth(now: Date = new Date()): { codes: number; tokens: number } {
  const db = getDb();
  const codes = db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, now)).run().changes;
  const refreshFloor = new Date(now.getTime() - REFRESH_TTL_MS);
  const tokens = db.delete(oauthTokens).where(lt(oauthTokens.createdAt, refreshFloor)).run().changes;
  return { codes, tokens };
}
