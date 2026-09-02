import { NextResponse } from 'next/server';

/**
 * Fixed-window per-IP rate limit for the public /api/v1 JSON API (Phase 10) —
 * the free acquisition channel gets no auth, so this is the only brake.
 * Same approach as the OAuth registration throttle
 * (src/app/api/oauth/register/route.ts): in-memory Map + periodic GC.
 * Per-process state, fine for the single-container deploy; a multi-replica
 * setup would need a shared store instead.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const buckets = new Map<string, Bucket>();

// GC: sweep expired buckets so a flood of spoofed IPs can't grow it forever
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) if (b.resetAt <= now) buckets.delete(ip);
}, 600e3).unref();

/** Requests per window per IP — API_RATE_LIMIT overrides the default 60/min. */
function limitPerWindow(): number {
  const n = Number(process.env.API_RATE_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60;
}

/** Client IP: rightmost x-forwarded-for hop (appended by our own reverse proxy).
 *  Leftmost entries are client-controlled — trusting them would let an attacker
 *  rotate spoofed IPs and bypass the limit entirely. Mirrors the login route's
 *  reasoning (src/app/api/auth/login/route.ts). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  const parts = fwd ? fwd.split(',') : [];
  return (parts.length > 0 ? parts[parts.length - 1].trim() : '') || 'unknown';
}

/**
 * Consume one request from this caller's bucket. Null when allowed; when the
 * bucket is over the limit, a ready-to-return 429 with a `{ error,
 * retry_after_s }` JSON body and a `retry-after` header.
 */
export function rateLimited(req: Request): NextResponse | null {
  const ip = clientIp(req);
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, b);
  }
  b.count += 1;
  if (b.count <= limitPerWindow()) return null;
  const retryAfterS = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  return NextResponse.json(
    { error: 'rate_limited', retry_after_s: retryAfterS },
    { status: 429, headers: { 'retry-after': String(retryAfterS) } },
  );
}

/** Test hook: clear all buckets so each test starts with a fresh limiter. */
export function _resetRateLimits(): void {
  buckets.clear();
}
