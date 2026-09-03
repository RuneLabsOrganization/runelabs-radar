import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

/**
 * Legacy session cookie for seeded CLI operators. The primary auth path is
 * Better Auth (see ./better-auth.ts, resolved first in ./user.ts); this
 * stateless HMAC token only remains for operator accounts the seed scripts
 * create. Stateless means no server-side revocation or rotation, so the TTL
 * is kept short (7 days) and the format is versioned: unversioned/v1 tokens
 * are rejected outright, which retired every pre-versioning token at cutover.
 */
export const SESSION_COOKIE = 'radar_session';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const VERSION = 'v2';

function hmac(payload: string): string {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
}

/** Token format: "v2.<uid>.<expiresEpochMs>.<hmacHex>" — the version sits inside the signed payload. */
export function signSession(userId: number, ttlMs: number = DEFAULT_TTL_MS): string {
  const expires = Date.now() + ttlMs;
  const payload = `${VERSION}.${userId}.${expires}`;
  return `${payload}.${hmac(payload)}`;
}

/** Returns the userId for a valid, unexpired v2 token; null otherwise. */
export function verifySession(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [version, uidStr, expStr, sig] = parts;
  if (version !== VERSION) return null;
  const expected = hmac(`${version}.${uidStr}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const expires = Number(expStr);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  const uid = Number(uidStr);
  if (!Number.isInteger(uid) || uid <= 0) return null;
  return uid;
}
