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

/**
 * Unit implied by the words around the price. Patterns are checked
 * specific-before-generic on ties; the caller picks the NEAREST match.
 */
const UNIT_PATTERNS: [MediaPriceUnit, RegExp][] = [
  ['per_second', /\/\s*(?:sec|second)|per\s+second/],
  ['per_image', /\/\s*(?:image|img)|per\s+image/],
  ['per_1k_chars', /1k\s*char|per\s*1,?000\s*char/],
  ['per_month', /\/\s*(?:mo|month)|per\s+month/],
];

/** The unit keyword closest to the start of `window`, or null. */
function nearestUnit(window: string): MediaPriceUnit | null {
  const t = window.toLowerCase();
  let best: { unit: MediaPriceUnit; at: number; order: number } | null = null;
  for (const [order, [unit, re]] of UNIT_PATTERNS.entries()) {
    const at = t.search(re);
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && order < best.order)) best = { unit, at, order };
  }
  return best?.unit ?? null;
}

/**
 * $ amount with optional thousands groups, cents and a k/K suffix:
 * "$1,200/mo" → 1200 (the old [0-9]+ regex stopped at the comma and read $1),
 * "$20k" → 20000. The k must not start a longer word ("$5 kg" stays 5).
 */
const AMOUNT_RE = /\$\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.([0-9]+))?\s*([kK](?![a-zA-Z]))?/g;

/** How far after an amount a unit keyword may sit and still describe it. */
const UNIT_WINDOW_CHARS = 32;

function parseAmount(groups: RegExpMatchArray): number | null {
  const n = Number(groups[1].replace(/,/g, '') + (groups[2] ? `.${groups[2]}` : '')) * (groups[3] ? 1000 : 1);
  return Number.isFinite(n) ? n : null;
}

/**
 * First $ amount that pairs with a unit keyword. Pairing is by proximity —
 * the nearest unit keyword AFTER the amount, within UNIT_WINDOW_CHARS — so a
 * joined row like "$10/mo or $0.05/image" yields (10, per_month) instead of
 * mixing the first amount with whatever unit appears first. Rows with no
 * amount/unit pair are skipped rather than guessed at.
 */
function priceWithUnit(cell: string): { amountUsd: number; unit: MediaPriceUnit } | null {
  for (const m of cell.matchAll(AMOUNT_RE)) {
    const amountUsd = parseAmount(m);
    if (amountUsd === null) continue;
    const after = cell.slice(m.index + m[0].length, m.index + m[0].length + UNIT_WINDOW_CHARS);
    const unit = nearestUnit(after);
    if (unit) return { amountUsd, unit };
  }
  return null;
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
    const price = priceWithUnit(joined);
    if (!price) continue;
    out.push({ tool, ...price });
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
  { key: 'ideogram', url: 'https://ideogram.ai/pricing', tools: ['Ideogram 4'] },
  { key: 'veo', url: 'https://ai.google.dev/gemini-api/docs/pricing', tools: ['Veo 3.1 Preview'] },
  { key: 'wan', url: 'https://www.alibabacloud.com/help/en/model-studio/wanx-video-generation-api', tools: ['Wan 2.7'] },
];

/**
 * last manual review: 2026-08-26 — verify against the URLs above each quarter.
 *
 * Tool names match kit_picks.pick_name EXACTLY, including qualifiers that
 * describe the deployment rather than an effort tier (e.g. "(Alibaba)"),
 * because matchPricedEntity refuses to strip a "(... via ...)" runtime
 * qualifier — a self-hosted variant of the same base name must never
 * silently inherit a hosted API price.
 */
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
  // Ideogram publishes three tiers (Turbo $0.03 / Default $0.06 / Quality
  // $0.10 per image, verified 2026-08-26); the pick name carries no tier
  // qualifier, so Default is the defensible middle rather than a guess at
  // which one Radar meant.
  ideogram: [{ tool: 'Ideogram 4', unit: 'per_image', amountUsd: 0.06 }],
  // Google publishes $0.05-0.15/sec for Lite/Fast and $0.40/sec for
  // Standard/Quality (verified 2026-08-26, multiple corroborating sources;
  // one outlier reseller reports $0.75/sec — not used, unconfirmed against
  // Google's own docs). Standard is used since Radar's board optimizes for
  // "best overall", not the budget tier.
  veo: [{ tool: 'Veo 3.1 Preview', unit: 'per_second', amountUsd: 0.4 }],
  // $0.10/sec corroborated by OpenRouter and Atlas Cloud (verified 2026-08-26).
  // Stored bare (no "(Alibaba)") — matchPricedEntity compares against the
  // STRIPPED pick name, so the priced entity must already be in stripped
  // form or it will never match.
  wan: [{ tool: 'Wan 2.7', unit: 'per_second', amountUsd: 0.1 }],
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
