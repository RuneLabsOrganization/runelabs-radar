/**
 * First-party provider price pipeline (master plan §6a). Scrapes each
 * provider's pricing page on a weekly cadence and records list prices into
 * metric_points (source 'provider-pricing') — the merged market reader,
 * Radar Score and margin dashboard all read these series. Every provider
 * also carries a manual fallback map: most pricing pages are JS-rendered,
 * so the fallback is an expected path, not an alarm.
 */
import { getDb } from '../db';
import { benchmarkSnapshots } from '../db/schema';
import { recordMetrics, type MetricInput } from '../metrics';
import { fetchText, stripHtml } from './adapters/shared';

export const PRICING_SOURCE = 'provider-pricing';

/** Cap on the raw page text kept in benchmark_snapshots for audit. */
const RAW_SNAPSHOT_CAP = 50_000;

/** USD per 1M tokens. Undefined fields = not published for that model. */
export interface ParsedPrice {
  model: string;
  priceIn?: number;
  priceOut?: number;
  priceCacheHit?: number;
}

/** Injectable so tests run fully offline; defaults to the shared fetchText. */
export type PriceFetcher = (url: string) => Promise<string>;

// type alias (not interface): object-alias types get an implicit index
// signature, so withJobRun's Record<string, unknown> stats constraint accepts it
export type PricingSyncStats = {
  recorded: number;
  /** Providers that contributed prices this run (parsed or fallback). */
  providers: number;
  /** Provider keys served from the manual fallback map. */
  fallback: string[];
  /** Provider key → error message for providers that failed outright. */
  errors: Record<string, string>;
};

/** Lowercase alphanumeric-only key, so "GPT-5.5 mini" matches a "gpt-5.5-mini" cell. */
function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** First number after a '$' in the cell; undefined when the cell carries no USD price. */
function usd(cell: string | undefined): number | undefined {
  if (!cell) return undefined;
  const m = cell.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** All HTML table rows on the page, as arrays of stripped cell text. */
function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripHtml(c[1]));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * Pull one price row per requested model out of a page's tables. Exact key
 * match wins over containment ("GPT-5.5" never steals "gpt-5.5-mini"'s row);
 * matched rows are consumed so two models can't share one row. `map` encodes
 * the provider's column layout. Parsers assume the page quotes per 1M tokens.
 */
function pickModels(
  html: string,
  models: readonly string[],
  map: (cells: string[]) => Omit<ParsedPrice, 'model'>,
): ParsedPrice[] {
  const pool = tableRows(html);
  const out: ParsedPrice[] = [];
  for (const model of models) {
    const key = nameKey(model);
    let idx = pool.findIndex((r) => nameKey(r[0] ?? '') === key);
    if (idx < 0) idx = pool.findIndex((r) => nameKey(r[0] ?? '').includes(key));
    if (idx < 0) continue;
    const [cells] = pool.splice(idx, 1);
    const p = map(cells);
    if (p.priceIn != null || p.priceOut != null || p.priceCacheHit != null) {
      out.push({ model, ...p });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Parsers — each small and specific to its page's current table markup */
/* ------------------------------------------------------------------ */

export const OPENAI_MODELS = ['GPT-5.5 mini', 'GPT-5.5'] as const;

/** platform.openai.com/docs/pricing table: [model, input, output]. */
export function parseOpenAiPricing(html: string): ParsedPrice[] {
  return pickModels(html, OPENAI_MODELS, (c) => ({ priceIn: usd(c[1]), priceOut: usd(c[2]) }));
}

export const ANTHROPIC_MODELS = ['Claude Opus 5', 'Claude Sonnet 4.5'] as const;

/**
 * docs.anthropic.com pricing table:
 * [model, input, 5m cache write, 1h cache write, cache hits, output] — the
 * cache columns sit between input and output, so output is the last cell.
 */
export function parseAnthropicPricing(html: string): ParsedPrice[] {
  return pickModels(html, ANTHROPIC_MODELS, (c) => ({ priceIn: usd(c[1]), priceOut: usd(c[5]) }));
}

export const GOOGLE_MODELS = ['Gemini 3 Pro', 'Gemini 3 Flash'] as const;

/** ai.google.dev/gemini-api/docs/pricing table: [model, input price, output price]. */
export function parseGooglePricing(html: string): ParsedPrice[] {
  return pickModels(html, GOOGLE_MODELS, (c) => ({ priceIn: usd(c[1]), priceOut: usd(c[2]) }));
}

export const DEEPSEEK_MODELS = ['DeepSeek-V4', 'DeepSeek-R2'] as const;

/** api-docs.deepseek.com pricing table: [model, input cache hit, input cache miss, output]. */
export function parseDeepSeekPricing(html: string): ParsedPrice[] {
  return pickModels(html, DEEPSEEK_MODELS, (c) => ({
    priceCacheHit: usd(c[1]),
    priceIn: usd(c[2]),
    priceOut: usd(c[3]),
  }));
}

export const MOONSHOT_MODELS = ['Kimi K3', 'Kimi K3 Turbo'] as const;

/** platform.moonshot.ai pricing table: [model, input, output]. */
export function parseMoonshotPricing(html: string): ParsedPrice[] {
  return pickModels(html, MOONSHOT_MODELS, (c) => ({ priceIn: usd(c[1]), priceOut: usd(c[2]) }));
}

export const MINIMAX_MODELS = ['MiniMax-M2'] as const;

/** platform.minimax.io token-plan table: [model, input cache hit, input cache miss, output]. */
export function parseMiniMaxPricing(html: string): ParsedPrice[] {
  return pickModels(html, MINIMAX_MODELS, (c) => ({
    priceCacheHit: usd(c[1]),
    priceIn: usd(c[2]),
    priceOut: usd(c[3]),
  }));
}

export const QWEN_MODELS = ['Qwen4-Max', 'Qwen4-Plus'] as const;

/** Alibaba Cloud Model Studio billing table: [model, input price, output price]. */
export function parseQwenPricing(html: string): ParsedPrice[] {
  return pickModels(html, QWEN_MODELS, (c) => ({ priceIn: usd(c[1]), priceOut: usd(c[2]) }));
}

/* ------------------------------------------------------------------ */

interface ProviderSpec {
  key: string;
  url: string;
  models: readonly string[];
  parse: (html: string) => ParsedPrice[];
}

/** The weekly scrape list. Order is irrelevant — providers are isolated. */
export const PROVIDERS: readonly ProviderSpec[] = [
  { key: 'openai', url: 'https://platform.openai.com/docs/pricing', models: OPENAI_MODELS, parse: parseOpenAiPricing },
  { key: 'anthropic', url: 'https://docs.anthropic.com/en/docs/about-claude/pricing', models: ANTHROPIC_MODELS, parse: parseAnthropicPricing },
  { key: 'google', url: 'https://ai.google.dev/gemini-api/docs/pricing', models: GOOGLE_MODELS, parse: parseGooglePricing },
  { key: 'deepseek', url: 'https://api-docs.deepseek.com/quick_start/pricing', models: DEEPSEEK_MODELS, parse: parseDeepSeekPricing },
  { key: 'moonshot', url: 'https://platform.moonshot.ai/docs/pricing', models: MOONSHOT_MODELS, parse: parseMoonshotPricing },
  { key: 'minimax', url: 'https://platform.minimax.io/docs/guides/pricing-token-plan', models: MINIMAX_MODELS, parse: parseMiniMaxPricing },
  { key: 'qwen', url: 'https://www.alibabacloud.com/help/en/model-studio/billing-for-model-studio', models: QWEN_MODELS, parse: parseQwenPricing },
];

/**
 * Last-known list prices, used when a provider's page is JS-rendered or its
 * markup changed enough that the parser yields zero rows. Keep in sync with
 * the provider pages on each manual review.
 *
 * last manual review: 2026-08
 */
export const MANUAL_FALLBACK: Record<string, ParsedPrice[]> = {
  // https://platform.openai.com/docs/pricing
  openai: [
    { model: 'GPT-5.5 mini', priceIn: 0.4, priceOut: 1.6 },
    { model: 'GPT-5.5', priceIn: 10.0, priceOut: 15.0 },
  ],
  // https://docs.anthropic.com/en/docs/about-claude/pricing
  anthropic: [
    { model: 'Claude Opus 5', priceIn: 15.0, priceOut: 75.0 },
    { model: 'Claude Sonnet 4.5', priceIn: 3.0, priceOut: 15.0 },
  ],
  // https://ai.google.dev/gemini-api/docs/pricing
  google: [
    { model: 'Gemini 3 Pro', priceIn: 2.0, priceOut: 12.0 },
    { model: 'Gemini 3 Flash', priceIn: 0.3, priceOut: 2.5 },
  ],
  // https://api-docs.deepseek.com/quick_start/pricing (publishes cache-hit prices)
  deepseek: [
    { model: 'DeepSeek-V4', priceCacheHit: 0.07, priceIn: 0.56, priceOut: 1.68 },
    { model: 'DeepSeek-R2', priceCacheHit: 0.14, priceIn: 1.1, priceOut: 4.35 },
  ],
  // https://platform.moonshot.ai/docs/pricing
  moonshot: [
    { model: 'Kimi K3', priceIn: 0.6, priceOut: 2.5 },
    { model: 'Kimi K3 Turbo', priceIn: 1.0, priceOut: 4.0 },
  ],
  // https://platform.minimax.io/docs/guides/pricing-token-plan (publishes cache-hit prices)
  minimax: [{ model: 'MiniMax-M2', priceCacheHit: 0.03, priceIn: 0.3, priceOut: 1.2 }],
  // https://www.alibabacloud.com/help/en/model-studio/billing-for-model-studio
  qwen: [
    { model: 'Qwen4-Max', priceIn: 1.6, priceOut: 6.4 },
    { model: 'Qwen4-Plus', priceIn: 0.4, priceOut: 1.2 },
  ],
};

function toMetricPoints(prices: ParsedPrice[]): MetricInput[] {
  const out: MetricInput[] = [];
  for (const p of prices) {
    if (p.priceIn != null) out.push({ source: PRICING_SOURCE, entity: p.model, metric: 'price_in', value: p.priceIn });
    if (p.priceOut != null) out.push({ source: PRICING_SOURCE, entity: p.model, metric: 'price_out', value: p.priceOut });
    if (p.priceCacheHit != null) {
      out.push({ source: PRICING_SOURCE, entity: p.model, metric: 'price_cache_hit', value: p.priceCacheHit });
    }
  }
  return out;
}

/**
 * Weekly price sync. One provider's failure never aborts the run: a
 * fetch/parse throw is recorded in stats.errors and skipped; a page that
 * parses to zero rows (changed markup / JS-rendered shell) is served from
 * the manual fallback map and flagged in stats.fallback.
 */
export async function runPricingSync(fetcher: PriceFetcher = fetchText): Promise<PricingSyncStats> {
  const db = getDb();
  const points: MetricInput[] = [];
  const stats: PricingSyncStats = { recorded: 0, providers: 0, fallback: [], errors: {} };

  for (const p of PROVIDERS) {
    try {
      const html = await fetcher(p.url);
      let prices = p.parse(html);
      let raw: string;
      if (prices.length === 0) {
        prices = MANUAL_FALLBACK[p.key] ?? [];
        stats.fallback.push(p.key);
        raw = JSON.stringify({
          fallback: true,
          reason: `parser yielded 0 rows for ${p.url} — page changed or JS-rendered`,
        });
      } else {
        raw = html.slice(0, RAW_SNAPSHOT_CAP);
      }
      db.insert(benchmarkSnapshots)
        .values({ source: `pricing-${p.key}`, raw, fetchedAt: new Date() })
        .run();
      points.push(...toMetricPoints(prices));
      stats.providers++;
    } catch (e) {
      stats.errors[p.key] = e instanceof Error ? e.message : String(e);
    }
  }

  stats.recorded = recordMetrics(points);
  return stats;
}
