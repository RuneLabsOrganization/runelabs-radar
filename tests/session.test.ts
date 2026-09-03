import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from '@/lib/auth/session';
import { config } from '@/lib/config';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function hmac(payload: string): string {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
}

describe('session tokens', () => {
  it('round-trips a valid v2 token', () => {
    const t = signSession(42);
    expect(t.startsWith('v2.')).toBe(true);
    expect(t.split('.')).toHaveLength(4);
    expect(verifySession(t)).toBe(42);
  });

  it('signs with a 7-day TTL by default', () => {
    const before = Date.now();
    const exp = Number(signSession(42).split('.')[2]);
    expect(exp - before).toBeGreaterThan(SEVEN_DAYS_MS - 5000);
    expect(exp - before).toBeLessThanOrEqual(SEVEN_DAYS_MS);
  });

  it('rejects a v1-format token even with a valid v1 signature', () => {
    // Pre-versioning format "<uid>.<exp>.<hmac(uid.exp)>" — signed correctly,
    // but unversioned tokens died at the format cutover.
    const exp = Date.now() + 60_000;
    const legacy = `42.${exp}.${hmac(`42.${exp}`)}`;
    expect(verifySession(legacy)).toBeNull();
  });

  it('rejects a v2 payload re-signed under a different version', () => {
    const exp = Date.now() + 60_000;
    const payload = `v1.42.${exp}`;
    expect(verifySession(`${payload}.${hmac(payload)}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const t = signSession(42);
    const parts = t.split('.');
    parts[3] = (parts[3][0] === 'a' ? 'b' : 'a') + parts[3].slice(1);
    expect(verifySession(parts.join('.'))).toBeNull();
  });

  it('rejects a tampered user id', () => {
    const t = signSession(42);
    const parts = t.split('.');
    parts[1] = '43';
    expect(verifySession(parts.join('.'))).toBeNull();
  });

  it('rejects an expired token', () => {
    const t = signSession(42, -1000);
    expect(verifySession(t)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession('')).toBeNull();
    expect(verifySession('a.b')).toBeNull();
    expect(verifySession('hello world')).toBeNull();
    expect(verifySession('1.2.3.4')).toBeNull();
    expect(verifySession('v2.0.99999999999.' + hmac('v2.0.99999999999'))).toBeNull();
  });
});
