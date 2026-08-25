/**
 * Request rate limiting for the MCP endpoint, backed by usage_counters.
 *
 * Previously a module-level Map in server.ts: it reset on every deploy and
 * counted independently in each replica, so the advertised limit was really
 * "limit x replicas, until the next restart". Now a fixed hour window in
 * SQLite, shared by every process pointed at the same database file.
 */
import { bump } from '../../src/lib/usage/counters';

let limitPerHour = Number(process.env.MCP_RATE_LIMIT ?? 300);

/** True when this bucket has exceeded its hourly allowance. */
export function rateLimited(bucket: string, now: Date = new Date()): boolean {
  return bump(bucket, 'rate', 'hour', now) > limitPerHour;
}

export function rateLimitPerHour(): number {
  return limitPerHour;
}

/** Test seam: re-read the env limit (or force one) without reimporting. */
export function _resetRateLimitForTest(limit?: number): void {
  limitPerHour = limit ?? Number(process.env.MCP_RATE_LIMIT ?? 300);
}
