import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from '@/lib/auth/session';

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const t = signSession(42);
    expect(verifySession(t)).toBe(42);
  });

  it('rejects a tampered signature', () => {
    const t = signSession(42);
    const parts = t.split('.');
    parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);
    expect(verifySession(parts.join('.'))).toBeNull();
  });

  it('rejects a tampered user id', () => {
    const t = signSession(42);
    const parts = t.split('.');
    parts[0] = '43';
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
  });
});
