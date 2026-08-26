import { config } from '../config';
import { fetchJson } from '../ingest/adapters/shared';

export interface ExaHit {
  title: string;
  url: string;
  description: string;
  publishedAt: Date | null;
}

interface ExaResult {
  title?: string;
  url?: string;
  publishedDate?: string;
  highlights?: string[];
  text?: string;
}

interface ExaSearchResponse {
  results?: ExaResult[];
}

const SEARCH_ENDPOINT = 'https://api.exa.ai/search';
// Exa bundles page contents into the base rate for the first 10 results only;
// results past that carry a per-result surcharge on top of the $7/1k base
// price. Default stays at 10 so a normal poll never crosses into overage.
const DEFAULT_COUNT = 10;
const MAX_COUNT = 25;
const EXCERPT_MAX = 400;

export class ExaSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExaSearchError';
  }
}

function token(): string {
  const key = config.exaApiKey;
  if (!key) throw new ExaSearchError('exa adapter requires EXA_API_KEY');
  return key;
}

function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function excerptOf(r: ExaResult): string {
  if (r.highlights && r.highlights.length > 0) return r.highlights.join(' — ').slice(0, EXCERPT_MAX);
  return (r.text ?? '').slice(0, EXCERPT_MAX);
}

function mapResults(results: ExaResult[] | undefined): ExaHit[] {
  const out: ExaHit[] = [];
  for (const r of results ?? []) {
    if (!r.url || !r.title) continue;
    out.push({
      url: r.url,
      title: r.title,
      description: excerptOf(r),
      publishedAt: parseDate(r.publishedDate),
    });
  }
  return out;
}

/**
 * One Exa /search request. Recency-biased query, highlights requested for a
 * short excerpt rather than full page text (keeps both the ingest payload
 * and the per-result content small). Throws on any HTTP error — the caller
 * (ingest/adapters/exa.ts) decides whether to fall back to Brave.
 */
export async function exaSearch(opts: { query: string; count?: number }): Promise<ExaHit[]> {
  const numResults = Math.min(
    MAX_COUNT,
    Math.max(1, Math.floor(Number.isFinite(opts.count) ? (opts.count as number) : DEFAULT_COUNT)),
  );
  const res = await fetchJson<ExaSearchResponse>(SEARCH_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': token(),
    },
    body: JSON.stringify({
      query: opts.query,
      numResults,
      type: 'auto',
      contents: { highlights: true },
    }),
  });
  return mapResults(res.results);
}
