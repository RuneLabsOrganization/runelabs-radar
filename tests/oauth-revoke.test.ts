import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@/lib/db/schema';

type User = typeof users.$inferSelect;
import {
  createCode,
  exchangeCode,
  listUserConnections,
  refreshGrant,
  registerClient,
  revokeToken,
  revokeUserClient,
  validateAccessToken,
  type ClientRow,
} from '@/lib/oauth';
import { POST as revokePost } from '@/app/api/oauth/revoke/route';
import { POST as disconnectPost } from '@/app/api/oauth/disconnect/route';
import { seedUser, useTestDb } from './helpers/db';

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mocks.getCurrentUser }));

function pkce(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const VERIFIER = 'correct-horse-battery-staple-verifier-string-43chars!';
const REDIRECT = 'http://localhost:8765/callback';

let db: ReturnType<typeof useTestDb>;

beforeEach(() => {
  db = useTestDb();
  mocks.getCurrentUser.mockReset();
});

function viewer(userId: number): User {
  return db.select().from(users).where(eq(users.id, userId)).get()!;
}

/** Register a client once, then drive it through code exchanges → live grants. */
function clientNamed(clientName: string): ClientRow {
  return registerClient(clientName, [REDIRECT]);
}

function grant(userId: number, client: ClientRow) {
  const code = createCode({
    clientId: client.clientId,
    userId,
    redirectUri: REDIRECT,
    scope: 'read plans',
    codeChallenge: pkce(VERIFIER),
  });
  return exchangeCode(code, REDIRECT, VERIFIER, client.clientId)!;
}

function revokeRequest(body: string): Request {
  return new Request('http://localhost/api/oauth/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('revokeToken (RFC 7009 backing store)', () => {
  it('revoking by access token kills both the access and the refresh token', () => {
    const userId = seedUser(db);
    const tokens = grant(userId, clientNamed('agent-a'));
    expect(validateAccessToken(tokens.accessToken)).not.toBeNull();

    expect(revokeToken(tokens.accessToken)).toBe(true);

    expect(validateAccessToken(tokens.accessToken)).toBeNull();
    expect(refreshGrant(tokens.refreshToken)).toBeNull();
  });

  it('revoking by refresh token kills the pair too', () => {
    const userId = seedUser(db);
    const tokens = grant(userId, clientNamed('agent-b'));
    expect(revokeToken(tokens.refreshToken)).toBe(true);
    expect(validateAccessToken(tokens.accessToken)).toBeNull();
  });

  it('returns false for unknown or malformed tokens', () => {
    expect(revokeToken('never-issued')).toBe(false);
    expect(revokeToken('')).toBe(false);
    expect(revokeToken('x'.repeat(1025))).toBe(false);
  });
});

describe('POST /api/oauth/revoke', () => {
  it('answers 200 for an unknown token — existence must not leak', async () => {
    const res = await revokePost(revokeRequest('token=never-issued'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 200 and the revoked token stops validating', async () => {
    const userId = seedUser(db);
    const tokens = grant(userId, clientNamed('agent-c'));
    const res = await revokePost(revokeRequest(`token=${encodeURIComponent(tokens.accessToken)}`));
    expect(res.status).toBe(200);
    expect(validateAccessToken(tokens.accessToken)).toBeNull();
  });

  it('answers 200 even for a malformed body', async () => {
    const res = await revokePost(
      new Request('http://localhost/api/oauth/revoke', { method: 'POST', body: '\udc00' }),
    );
    expect(res.status).toBe(200);
  });
});

describe('listUserConnections / revokeUserClient', () => {
  it('groups live grants per client with merged scopes', () => {
    const userId = seedUser(db);
    const a = clientNamed('agent-a');
    grant(userId, a);
    grant(userId, a); // second refresh chain for the SAME client
    grant(userId, clientNamed('agent-b'));

    const connections = listUserConnections(userId);
    expect(connections).toHaveLength(2);
    const connA = connections.find((c) => c.clientName === 'agent-a')!;
    expect(connA.grants).toBe(2);
    expect(connA.scope.split(' ').sort()).toEqual(['plans', 'read']);
    expect(connA.connectedAt).toBeInstanceOf(Date);
  });

  it('lists only the given user’s grants', () => {
    const userA = seedUser(db);
    const userB = seedUser(db);
    grant(userA, clientNamed('agent-a'));
    grant(userB, clientNamed('agent-b'));
    expect(listUserConnections(userA).map((c) => c.clientName)).toEqual(['agent-a']);
  });

  it('revokeUserClient drops every grant for (user, client) and nothing else', () => {
    const userA = seedUser(db);
    const userB = seedUser(db);
    const shared = clientNamed('agent-a');
    const a1 = grant(userA, shared);
    const a2 = grant(userA, clientNamed('agent-b'));
    const b1 = grant(userB, shared);

    const removed = revokeUserClient(userA, shared.clientId);
    expect(removed).toBe(1);
    expect(validateAccessToken(a1.accessToken)).toBeNull();
    expect(validateAccessToken(a2.accessToken)).not.toBeNull();
    expect(validateAccessToken(b1.accessToken)).not.toBeNull();
  });
});

describe('POST /api/oauth/disconnect', () => {
  function disconnectRequest(clientId: string, formPost = true): Request {
    if (formPost) {
      return new Request('http://localhost/api/oauth/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `client_id=${encodeURIComponent(clientId)}`,
      });
    }
    return new Request('http://localhost/api/oauth/disconnect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    });
  }

  it('requires a signed-in user', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await disconnectPost(disconnectRequest('whatever'));
    expect(res.status).toBe(401);
  });

  it('drops all of the user’s grants for the client and redirects form posts back', async () => {
    const userId = seedUser(db);
    const target = clientNamed('agent-a');
    grant(userId, target);
    grant(userId, target); // second chain for the same client
    const other = grant(userId, clientNamed('agent-b'));
    mocks.getCurrentUser.mockResolvedValue(viewer(userId));

    const res = await disconnectPost(disconnectRequest(target.clientId));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/oauth/connections');
    expect(listUserConnections(userId).map((c) => c.clientName)).toEqual(['agent-b']);
    expect(validateAccessToken(other.accessToken)).not.toBeNull();
  });

  it('answers JSON for non-form posts', async () => {
    const userId = seedUser(db);
    const target = clientNamed('agent-a');
    grant(userId, target);
    mocks.getCurrentUser.mockResolvedValue(viewer(userId));
    const res = await disconnectPost(disconnectRequest(target.clientId, false));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: 1 });
  });

  it('rejects explicitly cross-site requests and invalid client_id', async () => {
    const userId = seedUser(db);
    mocks.getCurrentUser.mockResolvedValue(viewer(userId));

    const crossSite = await disconnectPost(
      new Request('http://localhost/api/oauth/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
        body: JSON.stringify({ client_id: 'abc' }),
      }),
    );
    expect(crossSite.status).toBe(403);

    const bad = await disconnectPost(disconnectRequest(''));
    expect(bad.status).toBe(400);
  });
});
