import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { authenticate } from '../mcp/lib/auth';
import { createCode, exchangeCode, refreshGrant, registerClient } from '@/lib/oauth';
import { stripCjkLeak } from '@/lib/prompt-hygiene';
import { _setFetch } from '@/lib/llm/minimax';
import { generateBrief } from '@/lib/opportunities/brief';
import { opportunities, users } from '@/lib/db/schema';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;

const VERIFIER = 'hardening-test-verifier-hardening-test-verifier-43!';
const REDIRECT = 'http://localhost:8765/callback';
const pkce = (v: string) => createHash('sha256').update(v).digest('base64url');

function fakeReq(token?: string): IncomingMessage {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    socket: { remoteAddress: '10.0.0.1' },
  } as unknown as IncomingMessage;
}

function issueToken(scope = 'read plans'): { accessToken: string; refreshToken: string; userId: number } {
  const userId = db.insert(users).values({ name: 'u1', passwordHash: 'x', role: 'admin' }).returning({ id: users.id }).get().id;
  const client = registerClient('agent', [REDIRECT]);
  const code = createCode({ clientId: client.clientId, userId, redirectUri: REDIRECT, scope, codeChallenge: pkce(VERIFIER) });
  const grant = exchangeCode(code, REDIRECT, VERIFIER, client.clientId)!;
  return { accessToken: grant.accessToken, refreshToken: grant.refreshToken, userId };
}

describe('hardening: limiter keys survive refresh rotation', () => {
  beforeEach(() => {
    db = useTestDb();
    delete process.env.MCP_AUTH_REQUIRED;
  });

  it('keys the rate bucket by user, not token row', () => {
    const { accessToken, refreshToken, userId } = issueToken();
    const before = authenticate(fakeReq(accessToken));
    expect(before?.rateKey).toBe(`user:${userId}`);

    // rotate — the new token row has a new id, but the limiter key must not change
    const rotated = refreshGrant(refreshToken)!;
    const after = authenticate(fakeReq(rotated.accessToken));
    expect(after?.rateKey).toBe(`user:${userId}`);
    expect(after?.rateKey).toBe(before?.rateKey);
  });

  it('anonymous mode: stale bearer falls back to anonymous instead of 401', () => {
    const ctx = authenticate(fakeReq('stale-or-expired-token'));
    expect(ctx).not.toBeNull();
    expect(ctx!.authed).toBe(false);
    expect(ctx!.rateKey).toBe('ip:10.0.0.1');
  });

  it('auth-required mode: stale bearer is a hard 401 (null context)', () => {
    process.env.MCP_AUTH_REQUIRED = 'true';
    expect(authenticate(fakeReq('bogus'))).toBeNull();
    expect(authenticate(fakeReq())).toBeNull();
  });
});

describe('hardening: stripCjkLeak leaves clean text byte-identical', () => {
  it('does not touch whitespace in CJK-free markdown', () => {
    const md = '## Plan\n\n```ts\n  const x = 1;\n    const y = 2;\n```\n\n- item\n  - nested\n';
    expect(stripCjkLeak(md)).toBe(md);
  });

  it('strips Hangul and astral-plane ideographs too', () => {
    expect(stripCjkLeak('check 한자 here')).toBe('check here');
    expect(stripCjkLeak('rare 𠀀 char')).toBe('rare char');
  });
});

describe('hardening: launch brief market gating', () => {
  beforeEach(() => {
    db = useTestDb();
    process.env.MINIMAX_API_KEY = 'test-key';
    db.insert(opportunities)
      .values({
        slug: 'gated-opp',
        title: 'Gated opportunity',
        thesis: 'A thesis long enough to matter for the brief generator test.',
        sector: 'devtools',
        status: 'active',
        flipScore: 60,
        holdScore: 50,
        scores: '{}',
        evidence: '[]',
        verdict: 'watch',
        confidence: 40,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })
      .run();
  });

  function capturePrompt(): { body: () => string } {
    let captured = '';
    _setFetch((async (_url: unknown, init: { body: string }) => {
      captured = init.body;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  icp: 'Developers who need this specific thing done weekly',
                  mvp: ['feature one', 'feature two', 'feature three'],
                  unitEconomics: { assumptions: [], monthlyCostUsd: 10, suggestedPriceUsd: 20, breakEvenCustomers: 1 },
                  gtm: ['channel one'],
                  risks: ['risk one'],
                }),
              },
            },
          ],
          usage: {},
        }),
      } as Response;
    }) as unknown as typeof fetch);
    return { body: () => captured };
  }

  it('withholds the market block when allowMarket=false', async () => {
    const cap = capturePrompt();
    const res = await generateBrief(1, { allowMarket: false });
    expect(res.ok).toBe(true);
    expect(cap.body()).toContain('market data withheld');
  });

  it('includes the market block when allowMarket=true', async () => {
    const cap = capturePrompt();
    const res = await generateBrief(1, { allowMarket: true });
    expect(res.ok).toBe(true);
    expect(cap.body()).toContain('<model-market>');
    expect(cap.body()).not.toContain('withheld');
  });
});
