/**
 * Paid-search spend guard. Exa and Brave bill per request, so every request is
 * counted in the durable usage_counters table (shared by web/worker/mcp, survives
 * deploys) and refused once the monthly OR derived daily cap is reached.
 *
 * Caps are request counts, not dollars, because both vendors bill a flat
 * per-request rate: Brave ~$5 per 1k requests (the $5 plan ≈ 1000), Exa $7 per
 * 1k. Defaults leave headroom under a $5/month plan; override with
 * EXA_MONTHLY_CALL_CAP / BRAVE_MONTHLY_CALL_CAP (0 disables that provider).
 * The daily cap (monthly/30, rounded up) stops a burst from burning the whole
 * month in one day. Attempts are counted, not just successes: a refused 402 may
 * still be metered by the vendor, so under-counting is the unsafe direction.
 */
import { and, eq, gte } from 'drizzle-orm';
import { getDb } from '../db';
import { usageCounters } from '../db/schema';
import { bump } from '../usage/counters';

export type SearchProvider = 'exa' | 'brave';

export const SEARCH_BUCKET_PREFIX = 'search:';
const FEATURE = 'calls';

const DEFAULT_MONTHLY_CAP: Record<SearchProvider, number> = { exa: 600, brave: 900 };
const ENV_NAME: Record<SearchProvider, string> = {
  exa: 'EXA_MONTHLY_CALL_CAP',
  brave: 'BRAVE_MONTHLY_CALL_CAP',
};

export class SearchBudgetError extends Error {
  readonly provider: SearchProvider;
  constructor(provider: SearchProvider, message: string) {
    super(message);
    this.name = 'SearchBudgetError';
    this.provider = provider;
  }
}

export function monthlyCap(provider: SearchProvider): number {
  const raw = process.env[ENV_NAME[provider]];
  if (raw === undefined || raw.trim() === '') return DEFAULT_MONTHLY_CAP[provider];
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[search-budget] ${ENV_NAME[provider]}="${raw}" is invalid — using ${DEFAULT_MONTHLY_CAP[provider]}`);
    return DEFAULT_MONTHLY_CAP[provider];
  }
  return Math.floor(n);
}

export function dailyCap(provider: SearchProvider): number {
  return Math.ceil(monthlyCap(provider) / 30);
}

function bucket(provider: SearchProvider): string {
  return `${SEARCH_BUCKET_PREFIX}${provider}`;
}

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Requests spent so far today and this UTC month. */
export function searchUsage(provider: SearchProvider, now: Date = new Date()): { today: number; month: number } {
  const db = getDb();
  const rows = db
    .select({ windowStart: usageCounters.windowStart, count: usageCounters.count })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.bucket, bucket(provider)),
        eq(usageCounters.feature, FEATURE),
        gte(usageCounters.windowStart, utcMonthStart(now)),
      ),
    )
    .all();
  const dayMs = utcDayStart(now).getTime();
  let month = 0;
  let today = 0;
  for (const r of rows) {
    month += r.count;
    if (r.windowStart.getTime() === dayMs) today += r.count;
  }
  return { today, month };
}

/**
 * Reserve one request. Throws SearchBudgetError (and counts nothing) when the
 * daily or monthly cap is already spent; otherwise counts it and returns.
 * Call immediately before the HTTP request.
 */
export function reserveSearchCall(provider: SearchProvider, now: Date = new Date()): void {
  const month = monthlyCap(provider);
  if (month === 0) throw new SearchBudgetError(provider, `${provider} search disabled (${ENV_NAME[provider]}=0)`);
  const { today, month: spent } = searchUsage(provider, now);
  if (spent >= month) {
    throw new SearchBudgetError(provider, `${provider} monthly search budget spent (${spent}/${month}) — resumes next UTC month`);
  }
  const day = dailyCap(provider);
  if (today >= day) {
    throw new SearchBudgetError(provider, `${provider} daily search budget spent (${today}/${day}) — resumes at 00:00 UTC`);
  }
  bump(bucket(provider), FEATURE, 'day', now);
}

/** Search spend rows are monthly-scale — retained past the 2-day default counter GC. */
export const SEARCH_RETENTION_MS = 40 * 864e5;
