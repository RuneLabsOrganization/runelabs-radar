/**
 * Per-unit pricing for non-LLM tools (image, video, audio, ads).
 *
 * Sibling of ingest/pricing.ts, which covers per-token LLM pricing. Split
 * deliberately: these tools price per image, per second of output or per
 * seat, which do not share a unit with $/1M tokens and must not be averaged
 * together. Records into metric_points (source 'media-pricing'); the kit
 * price backfill (kits/grade.ts) reads the series.
 *
 * Like pricing.ts, most of these pages are JS-rendered, so MANUAL_FALLBACK is
 * an expected path rather than an alarm — keep it reviewed.
 *
 * last manual review: 2026-08-26
 */
import { getDb } from '../db';
import { benchmarkSnapshots } from '../db/schema';
import { recordMetrics, type MetricInput } from '../metrics';
import { fetchText, stripHtml } from './adapters/shared';

export const MEDIA_PRICING_SOURCE = 'media-pricing';
const RAW_SNAPSHOT_CAP = 50_000;

export type MediaPriceUnit = 'per_image' | 'per_second' | 'per_month' | 'per_1k_chars';

export interface MediaPrice {
  tool: string;
  unit: MediaPriceUnit;
  amountUsd: number;
}

export type MediaPricingStats = {
  recorded: number;
  providers: number;
  fallback: string[];
  errors: Record<string, string>;
};

function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Unit implied by the words around the price. Order matters: check the specific before the generic. */
function unitFrom(cell: string): MediaPriceUnit | null {
  const t = cell.toLowerCase();
  if (/\/\s*(sec|second)|per\s+second/.test(t)) return 'per_second';
  if (/\/\s*(image|img)|per\s+image/.test(t)) return 'per_image';
  if (/1k\s*char|per\s*1,?000\s*char/.test(t)) return 'per_1k_chars';
  if (/\/\s*(mo|month)|per\s+month/.test(t)) return 'per_month';
  return null;
}

function usd(cell: string): number | null {
  const m = cell.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripHtml(c[1]));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * Pull one price per requested tool from any table on the page. Exact key
 * match wins over containment so "Kling 3.0" never steals "Kling 3.0 Pro".
 * A row without both a $ amount and a recognisable unit is skipped rather
 * than guessed at.
 */
export function parseMediaTable(html: string, tools: readonly string[]): MediaPrice[] {
  const pool = tableRows(html);
  const out: MediaPrice[] = [];
  for (const tool of tools) {
    const key = nameKey(tool);
    let idx = pool.findIndex((r) => nameKey(r[0] ?? '') === key);
    if (idx < 0) idx = pool.findIndex((r) => nameKey(r[0] ?? '').includes(key));
    if (idx < 0) continue;
    const [cells] = pool.splice(idx, 1);
    const joined = cells.slice(1).join(' ');
    const amountUsd = usd(joined);
    const unit = unitFrom(joined);
    if (amountUsd === null || unit === null) continue;
    out.push({ tool, unit, amountUsd });
  }
  return out;
}

interface MediaProviderSpec {
  key: string;
  url: string;
  tools: readonly string[];
}

/**
 * Tools that appear on the kit grid and publish a public price. Keep this list
 * aligned with kit_picks.pick_name values — a tool priced here but never
 * picked is wasted scraping, and a pick never priced here renders as
 * "price unknown".
 */
export const MEDIA_PROVIDERS: readonly MediaProviderSpec[] = [
  { key: 'kling', url: 'https://klingai.com/pricing', tools: ['Kling 3.0'] },
  { key: 'seedream', url: 'https://www.volcengine.com/pricing', tools: ['Seedream 5.0 Pro', 'Seedream 4'] },
  { key: 'midjourney', url: 'https://docs.midjourney.com/docs/plans', tools: ['Midjourney Standard', 'Midjourney V8.1'] },
  { key: 'runway', url: 'https://runwayml.com/pricing', tools: ['Runway Gen-4.5'] },
  { key: 'heygen', url: 'https://www.heygen.com/pricing', tools: ['HeyGen'] },
];

/** last manual review: 2026-08-26 — verify against the URLs above each quarter. */
export const MANUAL_MEDIA_FALLBACK: Record<string, MediaPrice[]> = {
  kling: [{ tool: 'Kling 3.0', unit: 'per_second', amountUsd: 0.1 }],
  seedream: [
    { tool: 'Seedream 5.0 Pro', unit: 'per_image', amountUsd: 0.054 },
    { tool: 'Seedream 4', unit: 'per_image', amountUsd: 0.029 },
  ],
  midjourney: [
    { tool: 'Midjourney Standard', unit: 'per_month', amountUsd: 30 },
    { tool: 'Midjourney V8.1', unit: 'per_month', amountUsd: 10 },
  ],
  runway: [{ tool: 'Runway Gen-4.5', unit: 'per_second', amountUsd: 0.12 }],
  heygen: [{ tool: 'HeyGen', unit: 'per_month', amountUsd: 29 }],
};

function toMetricPoints(prices: MediaPrice[]): MetricInput[] {
  return prices.map((p) => ({
    source: MEDIA_PRICING_SOURCE,
    entity: p.tool,
    metric: `price_${p.unit}`,
    value: p.amountUsd,
  }));
}

export async function runMediaPricingSync(
  fetcher: (url: string) => Promise<string> = fetchText,
): Promise<MediaPricingStats> {
  const db = getDb();
  const points: MetricInput[] = [];
  const stats: MediaPricingStats = { recorded: 0, providers: 0, fallback: [], errors: {} };

  for (const p of MEDIA_PROVIDERS) {
    try {
      const html = await fetcher(p.url);
      let prices = parseMediaTable(html, p.tools);
      let raw: string;
      if (prices.length === 0) {
        prices = MANUAL_MEDIA_FALLBACK[p.key] ?? [];
        stats.fallback.push(p.key);
        raw = JSON.stringify({ fallback: true, reason: `parser yielded 0 rows for ${p.url}` });
      } else {
        raw = html.slice(0, RAW_SNAPSHOT_CAP);
      }
      db.insert(benchmarkSnapshots)
        .values({ source: `media-pricing-${p.key}`, raw, fetchedAt: new Date() })
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
