import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { oauthTokens, users } from '@/lib/db/schema';
import {
  createCode,
  exchangeCode,
  getClient,
  refreshGrant,
  registerClient,
  sanitizeScopes,
  validateAccessToken,
} from '@/lib/oauth';
import { useTestDb } from './helpers/db';

function pkce(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const VERIFIER = 'correct-horse-battery-staple-verifier-string-43chars!';
const REDIRECT = 'http://localhost:8765/callback';

let db: ReturnType<typeof useTestDb>;

function seedUser(): number {
  return db
    .insert(users)
    .values({ name: 'specter', passwordHash: 'x', role: 'admin' })
    .returning({ id: users.id })
    .get().id;
}

describe('oauth store', () => {
  beforeEach(() => {
    db = useTestDb();
  });

  it('sanitizes scopes to the known set, defaulting to read', () => {
    expect(sanitizeScopes('read bogus plans')).toBe('read plans');
    expect(sanitizeScopes('plans read batches')).toBe('read plans batches');
    expect(sanitizeScopes('batches read')).toBe('read batches');
    expect(sanitizeScopes('bogus')).toBe('read');
    expect(sanitizeScopes('')).toBe('read');
    expect(sanitizeScopes(undefined)).toBe('read');
  });

  it('registers clients and reads them back with parsed redirect URIs', () => {
    const client = registerClient('claude-desktop', [REDIRECT, 'https://claude.ai/api/mcp/auth_callback']);
    expect(client.clientId).toHaveLength(43);
    const fetched = getClient(client.clientId);
    expect(fetched?.name).toBe('claude-desktop');
    expect(fetched?.redirectUris).toContain(REDIRECT);
    expect(getClient('nonexistent')).toBeNull();
  });

  it('exchanges a code for tokens with PKCE S256, once', () => {
    const userId = seedUser();
    const client = registerClient('agent', [REDIRECT]);
    const code = createCode({
      clientId: client.clientId,
      userId,
      redirectUri: REDIRECT,
      scope: 'read plans',
      codeChallenge: pkce(VERIFIER),
    });
    const grant = exchangeCode(code, REDIRECT, VERIFIER, client.clientId);
    expect(grant).not.toBeNull();
    expect(grant!.scope).toBe('read plans');
    // single-use: replay with the same code fails
    expect(exchangeCode(code, REDIRECT, VERIFIER, client.clientId)).toBeNull();
  });

  it('rejects a wrong verifier and a wrong redirect_uri', () => {
    const userId = seedUser();
    const client = registerClient('agent', [REDIRECT]);
    const mk = () =>
      createCode({
        clientId: client.clientId,
        userId,
        redirectUri: REDIRECT,
        scope: 'read',
        codeChallenge: pkce(VERIFIER),
      });
    expect(exchangeCode(mk(), REDIRECT, 'wrong-verifier-wrong-verifier-wrong-verif', client.clientId)).toBeNull();
    expect(exchangeCode(mk(), 'http://localhost:9999/evil', VERIFIER, client.clientId)).toBeNull();
  });

  it('rejects a code presented by a different client', () => {
    const userId = seedUser();
    const client = registerClient('agent', [REDIRECT]);
    const other = registerClient('impostor', [REDIRECT]);
    const code = createCode({
      clientId: client.clientId,
      userId,
      redirectUri: REDIRECT,
      scope: 'read',
      codeChallenge: pkce(VERIFIER),
    });
    expect(exchangeCode(code, REDIRECT, VERIFIER, other.clientId)).toBeNull();
  });

  it('validates access tokens and rotates refresh tokens', () => {
    const userId = seedUser();
    const client = registerClient('agent', [REDIRECT]);
    const code = createCode({
      clientId: client.clientId,
      userId,
      redirectUri: REDIRECT,
      scope: 'read plans',
      codeChallenge: pkce(VERIFIER),
    });
    const grant = exchangeCode(code, REDIRECT, VERIFIER, client.clientId)!;
    const access = validateAccessToken(grant.accessToken);
    expect(access?.userId).toBe(userId);
    expect(access?.scope).toBe('read plans');

    const rotated = refreshGrant(grant.refreshToken)!;
    expect(rotated.accessToken).not.toBe(grant.accessToken);
    // old grant is dead: both its access token and its refresh token
    expect(validateAccessToken(grant.accessToken)).toBeNull();
    expect(refreshGrant(grant.refreshToken)).toBeNull();
    expect(validateAccessToken(rotated.accessToken)).not.toBeNull();
  });

  it('rejects expired access tokens', () => {
    const userId = seedUser();
    const client = registerClient('agent', [REDIRECT]);
    const code = createCode({
      clientId: client.clientId,
      userId,
      redirectUri: REDIRECT,
      scope: 'read',
      codeChallenge: pkce(VERIFIER),
    });
    const grant = exchangeCode(code, REDIRECT, VERIFIER, client.clientId)!;
    db.update(oauthTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthTokens.accessToken, grant.accessToken))
      .run();
    expect(validateAccessToken(grant.accessToken)).toBeNull();
  });
});
