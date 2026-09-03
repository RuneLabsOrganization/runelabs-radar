import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { oauthCodes, oauthTokens } from '@/lib/db/schema';
import {
  createCode,
  exchangeCode,
  refreshGrant,
  registerClient,
  sweepExpiredOAuth,
  validateAccessToken,
} from '@/lib/oauth';
import { runSweep } from '@/lib/sweep';
import { seedUser, useTestDb } from './helpers/db';

function pkce(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const VERIFIER = 'correct-horse-battery-staple-verifier-string-43chars!';
const REDIRECT = 'http://localhost:8765/callback';
const DAY = 24 * 36e5;

let db: ReturnType<typeof useTestDb>;

beforeEach(() => {
  db = useTestDb();
});

function grant(userId: number) {
  const client = registerClient('agent', [REDIRECT]);
  const code = createCode({
    clientId: client.clientId,
    userId,
    redirectUri: REDIRECT,
    scope: 'read',
    codeChallenge: pkce(VERIFIER),
  });
  return { client, code, tokens: exchangeCode(code, REDIRECT, VERIFIER, client.clientId)! };
}

function seedExpiredCode(userId: number, clientId: string): void {
  db.insert(oauthCodes)
    .values({
      code: 'expired-code',
      clientId,
      userId,
      redirectUri: REDIRECT,
      scope: 'read',
      codeChallenge: pkce(VERIFIER),
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 10 * 60e3),
    })
    .run();
}

describe('sweepExpiredOAuth', () => {
  it('removes expired codes and keeps valid ones', () => {
    const userId = seedUser(db);
    const { client } = grant(userId); // its code was consumed by the exchange
    seedExpiredCode(userId, client.clientId);

    const swept = sweepExpiredOAuth();
    expect(swept.codes).toBe(1);
    expect(swept.tokens).toBe(0);
    expect(db.select().from(oauthCodes).all()).toHaveLength(0);
    // a still-valid code survives the sweep and still exchanges
    const fresh = createCode({
      clientId: client.clientId,
      userId,
      redirectUri: REDIRECT,
      scope: 'read',
      codeChallenge: pkce(VERIFIER),
    });
    expect(sweepExpiredOAuth().codes).toBe(0);
    expect(exchangeCode(fresh, REDIRECT, VERIFIER, client.clientId)).not.toBeNull();
  });

  it('removes token rows whose refresh chain hit the absolute cap', () => {
    const userId = seedUser(db);
    const { tokens } = grant(userId);
    db.update(oauthTokens)
      .set({ createdAt: new Date(Date.now() - 181 * DAY), expiresAt: new Date(Date.now() - 180 * DAY) })
      .where(eq(oauthTokens.accessToken, tokens.accessToken))
      .run();

    expect(sweepExpiredOAuth().tokens).toBe(1);
    expect(validateAccessToken(tokens.accessToken)).toBeNull();
    expect(db.select().from(oauthTokens).all()).toHaveLength(0);
  });

  it('keeps rows whose access token expired but whose refresh chain is still alive', () => {
    const userId = seedUser(db);
    const { tokens } = grant(userId);
    // 2 days old: the 24h access token is expired, the 180-day chain is not.
    db.update(oauthTokens)
      .set({ createdAt: new Date(Date.now() - 2 * DAY), expiresAt: new Date(Date.now() - DAY) })
      .where(eq(oauthTokens.accessToken, tokens.accessToken))
      .run();

    expect(sweepExpiredOAuth().tokens).toBe(0);
    // the refresh chain must still rotate — a naive expires_at sweep would have killed it
    const rotated = refreshGrant(tokens.refreshToken);
    expect(rotated).not.toBeNull();
    expect(validateAccessToken(rotated!.accessToken)).not.toBeNull();
  });

  it('honors an explicit now for deterministic boundaries', () => {
    const userId = seedUser(db);
    const { tokens } = grant(userId);
    // 179 days old at the real now: dead relative to +2 days, alive relative to now
    db.update(oauthTokens)
      .set({ createdAt: new Date(Date.now() - 179 * DAY) })
      .where(eq(oauthTokens.accessToken, tokens.accessToken))
      .run();
    expect(sweepExpiredOAuth(new Date()).tokens).toBe(0);
    expect(sweepExpiredOAuth(new Date(Date.now() + 2 * DAY)).tokens).toBe(1);
  });
});

describe('runSweep', () => {
  it('includes OAuth sweeps in the returned stats', async () => {
    const userId = seedUser(db);
    const { client } = grant(userId);
    seedExpiredCode(userId, client.clientId);

    const stats = await runSweep();
    expect(stats.oauthCodes).toBe(1);
    expect(stats.oauthTokens).toBe(0);
    // pre-existing keys are untouched
    expect(stats).toMatchObject({
      leads: expect.any(Number),
      counters: expect.any(Number),
      launches: expect.any(Number),
      snapshots: expect.any(Number),
      batchRuns: expect.any(Number),
    });
  });
});
