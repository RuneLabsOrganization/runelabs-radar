/**
 * In-memory brute-force limiter for the legacy password login (single-instance
 * deployment): after MAX_FAILURES failed attempts per (ip, name) within the
 * window, the route rejects early. Same GC idiom as src/lib/api-limit.ts.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; resetAt: number }>();

// GC: periodic sweep so expired keys can't linger indefinitely when traffic
// stays below the size-triggered sweep in recordFailure.
setInterval(() => sweepExpiredFailures(), 300e3).unref();

export function clientKey(req: Request, name: string): string {
  // Rightmost XFF entry is the hop appended by our own reverse proxy; the
  // leftmost entries are client-controlled and would let an attacker rotate
  // keys (bypass) or spoof a victim's IP (lockout).
  const fwd = req.headers.get('x-forwarded-for');
  const parts = fwd ? fwd.split(',') : [];
  const ip = parts.length > 0 ? parts[parts.length - 1].trim() : 'local';
  return `${ip}|${name.toLowerCase()}`;
}

export function isLocked(key: string): boolean {
  const e = failures.get(key);
  return !!e && e.resetAt > Date.now() && e.count >= MAX_FAILURES;
}

export function recordFailure(key: string): void {
  if (failures.size > 1000) sweepExpiredFailures();
  const e = failures.get(key);
  if (!e || e.resetAt < Date.now()) {
    failures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    e.count++;
  }
}

export function clearFailures(key: string): void {
  failures.delete(key);
}

export function sweepExpiredFailures(now: number = Date.now()): void {
  for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
}

/** Test hooks: fresh limiter state per test, plus a size probe for GC tests. */
export function _resetLoginAttempts(): void {
  failures.clear();
}

export function _loginAttemptsSize(): number {
  return failures.size;
}
