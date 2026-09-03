import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@/lib/db/schema';

type User = typeof users.$inferSelect;
import { _resetRateLimits } from '@/lib/api-limit';
import { MAX_OAUTH_INPUT_LEN, registerClient } from '@/lib/oauth';
import { POST as tokenPost } from '@/app/api/oauth/token/route';
import { POST as authorizePost } from '@/app/api/oauth/authorize/route';
import { seedUser, useTestDb } from './helpers/db';

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mocks.getCurrentUser }));

function pkce(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const VERIFIER = 'correct-horse-battery-staple-verifier-string-43chars!';
const REDIRECT = 'http://localhost:8765/callback';
const ORIG_RATE_LIMIT = process.env.API_RATE_LIMIT;

let db: ReturnType<typeof useTestDb>;

beforeEach(() => {
  db = useTestDb();
  _resetRateLimits();
  mocks.getCurrentUser.mockReset();
  delete process.env.API_RATE_LIMIT;
});

afterEach(() => {
  if (ORIG_RATE_LIMIT === undefined) delete process.env.API_RATE_LIMIT;
  else process.env.API_RATE_LIMIT = ORIG_RATE_LIMIT;
});

function viewer(userId: number): User {
  return db.select().from(users).where(eq(users.id, userId)).get()!;
}

function formReq(url: string, params: Record<string, string>, ip = '203.0.113.9'): Request {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
    body: new URLSearchParams(params).toString(),
  });
}

function jsonReq(url: string, body: Record<string, string>): Request {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/oauth/token — input length caps', () => {
  it('rejects an oversize code_verifier with invalid_request', async () => {
    const res = await tokenPost(
      formReq('/api/oauth/token', {
        grant_type: 'authorization_code',
        code: 'abc',
        redirect_uri: REDIRECT,
        code_verifier: 'v'.repeat(MAX_OAUTH_INPUT_LEN + 1),
        client_id: 'xyz',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
  });

  it('rejects an oversize refresh_token', async () => {
    const res = await tokenPost(
      formReq('/api/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: 'r'.repeat(MAX_OAUTH_INPUT_LEN + 1),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
  });

  it('still answers invalid_grant (not invalid_request) for well-formed unknown grants', async () => {
    const res = await tokenPost(
      formReq('/api/oauth/token', {
        grant_type: 'authorization_code',
        code: 'never-issued',
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
        client_id: 'xyz',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });
});

describe('POST /api/oauth/token — throttle', () => {
  it('returns 429 with retry-after once the per-IP burst exceeds API_RATE_LIMIT', async () => {
    process.env.API_RATE_LIMIT = '2';
    const mk = () =>
      tokenPost(
        formReq('/api/oauth/token', {
          grant_type: 'authorization_code',
          code: 'never-issued',
          redirect_uri: REDIRECT,
          code_verifier: VERIFIER,
          client_id: 'xyz',
        }),
      );
    expect((await mk()).status).toBe(400);
    expect((await mk()).status).toBe(400);
    const third = await mk();
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).not.toBeNull();
    expect(third.headers.get('access-control-allow-origin')).toBe('*');
    expect((await third.json()).error).toBe('rate_limited');
  });

  it('tracks buckets per IP', async () => {
    process.env.API_RATE_LIMIT = '1';
    const mk = (ip: string) =>
      tokenPost(
        formReq(
          '/api/oauth/token',
          { grant_type: 'authorization_code', code: 'x', redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: 'y' },
          ip,
        ),
      );
    expect((await mk('198.51.100.1')).status).toBe(400);
    expect((await mk('198.51.100.2')).status).toBe(400);
    expect((await mk('198.51.100.1')).status).toBe(429);
  });
});

describe('POST /api/oauth/authorize — input length caps', () => {
  it('rejects an oversize code_challenge with 400 before any row is written', async () => {
    const userId = seedUser(db);
    mocks.getCurrentUser.mockResolvedValue(viewer(userId));
    const client = registerClient('agent', [REDIRECT]);

    const res = await authorizePost(
      jsonReq('/api/oauth/authorize', {
        client_id: client.clientId,
        redirect_uri: REDIRECT,
        code_challenge: 'c'.repeat(MAX_OAUTH_INPUT_LEN + 1),
        code_challenge_method: 'S256',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid code_challenge' });
  });

  it('rejects an oversize state with 400', async () => {
    const userId = seedUser(db);
    mocks.getCurrentUser.mockResolvedValue(viewer(userId));
    const client = registerClient('agent', [REDIRECT]);

    const res = await authorizePost(
      jsonReq('/api/oauth/authorize', {
        client_id: client.clientId,
        redirect_uri: REDIRECT,
        code_challenge: pkce(VERIFIER),
        code_challenge_method: 'S256',
        state: 's'.repeat(MAX_OAUTH_INPUT_LEN + 1),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid state' });
  });

  it('still issues a code for well-formed requests at the length cap boundary', async () => {
    const userId = seedUser(db);
    mocks.getCurrentUser.mockResolvedValue(viewer(userId));
    const client = registerClient('agent', [REDIRECT]);

    const res = await authorizePost(
      jsonReq('/api/oauth/authorize', {
        client_id: client.clientId,
        redirect_uri: REDIRECT,
        code_challenge: pkce(VERIFIER),
        code_challenge_method: 'S256',
        state: 's'.repeat(MAX_OAUTH_INPUT_LEN),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.redirect).toBe('string');
    // loopback redirects land on /oauth/complete with the callback (carrying
    // the code) inside the url-encoded `to` param
    expect(decodeURIComponent(body.redirect)).toContain('code=');
  });
});
