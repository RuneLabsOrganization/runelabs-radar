import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

export const SESSION_COOKIE = 'radar_session';
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hmac(payload: string): string {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
}

/** Token format: "<uid>.<expiresEpochMs>.<hmacHex>" */
export function signSession(userId: number, ttlMs: number = DEFAULT_TTL_MS): string {
  const expires = Date.now() + ttlMs;
  const payload = `${userId}.${expires}`;
  return `${payload}.${hmac(payload)}`;
}

/** Returns the userId for a valid, unexpired token; null otherwise. */
export function verifySession(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [uidStr, expStr, sig] = parts;
  const expected = hmac(`${uidStr}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const expires = Number(expStr);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  const uid = Number(uidStr);
  if (!Number.isInteger(uid) || uid <= 0) return null;
  return uid;
}
