/**
 * Open benchmark + media + OpenRouter ingest (master plan §6b).
 *
 * First-party time series, written weekly into metric_points:
 *   source 'openrouter' — per-model token pricing from OpenRouter's public
 *     /api/v1/models endpoint (no key). metric: 'price_in' | 'price_out',
 *     USD per 1M tokens (their API quotes per-token strings).
 *   source 'open-bench' — capability scores. metric:
 *     'intelligence'  0-100 composite (seed table)
 *     'elo'           LMArena text arena ELO (seed table)
 *     'image_elo'     text-to-image arena ELO (seed table)
 *     'video_elo'     text-to-video arena ELO (seed table)
 *     'livebench'     LiveBench global average (live fetch)
 *
 * Live vs seed: LMArena has no stable machine-readable export (probed
 * 2026-08: leaderboard is a gradio app; the HF datasets hold raw votes, not
 * scores), so arena + composite numbers come from the manually reviewed
 * SEED_MODELS table below — that is the primary path. LiveBench publishes a
 * static per-release CSV/JSON export; that one live source is fetched
 * best-effort on top, under its own metric key ('livebench') so it can never
 * clobber the hand-reviewed 'intelligence' series on the same day.
 * Speech arena: skipped — no clean public source exists (probed 2026-08).
 *
 * Every source is failure-isolated and leaves an audit row in
 * benchmark_snapshots (source 'openrouter' | 'open-bench-livebench' |
 * 'open-bench-seed'). Registration (weekly cron in worker/index.ts +
 * worker/run.ts job map) is done by the integrator, not here.
 */

import { getDb } from '../db';
import { benchmarkSnapshots } from '../db/schema';
import { recordMetrics, type MetricInput } from '../metrics';
import { fetchText } from './adapters/shared';

/** Injected for offline tests; production default is the shared retried fetcher. */
export type FetchTextFn = (url: string) => Promise<string>;

/** Raw audit snapshots are capped (~50KB) so a ballooning payload can't bloat the DB. */
const RAW_SNAPSHOT_MAX = 50_000;

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const LIVEBENCH_BASE = 'https://livebench.ai';

export type SourceStat = { name: string; ok: boolean; points: number; release?: string; error?: string };
export type OpenBenchStats = { recorded: number; snapshots: number; sources: SourceStat[] };

// ── Static seed table ────────────────────────────────────────────────────────

export interface SeedModel {
  /** Vendor-public display name — later phases join metric series on this. */
  entity: string;
  /** 0-100 capability composite (model cards / AA-style index, transcribed). */
  intelligence?: number;
  /** LMArena text arena ELO. */
  elo?: number;
  /** LMArena text-to-image arena ELO. */
  imageElo?: number;
  /** LMArena text-to-video arena ELO. */
  videoElo?: number;
  /** LiveBench slug prefix enabling live augmentation (see liveBenchPoints). */
  livebench?: string;
}

/**
 * Static seed table — the PRIMARY source of open-bench capability scores.
 * There is no stable machine-readable LMArena API, so these are transcribed
 * by hand from the public leaderboards and official model cards:
 *   text arena  — https://lmarena.ai/leaderboard (Text)
 *   image arena — https://lmarena.ai/leaderboard (Text-to-Image)
 *   video arena — https://lmarena.ai/leaderboard (Text-to-Video)
 *   composite   — vendor model cards + https://livebench.ai global average
 * Keep to ~15-20 builder-relevant LLMs plus the media models our image/video
 * domains track. Media arenas get their own metric keys ('image_elo' /
 * 'video_elo') so a model present in both text and media arenas never
 * collides on (source, entity, metric, date).
 * last manual review: 2026-08
 */
export const SEED_MODELS: SeedModel[] = [
  // frontier closed weights
  { entity: 'GPT-5.5', intelligence: 68, elo: 1486, livebench: 'gpt-5-5' },
  { entity: 'GPT-5.2-Codex', intelligence: 62, livebench: 'gpt-5-2-codex' },
  { entity: 'Claude Opus 4.7', intelligence: 66, elo: 1472, livebench: 'claude-opus-4-7' },
  { entity: 'Claude Sonnet 5', intelligence: 61, elo: 1459, livebench: 'claude-sonnet-5' },
  { entity: 'Claude Sonnet 4.5', intelligence: 55, elo: 1441, livebench: 'claude-sonnet-4-5' },
  { entity: 'Gemini 3.1 Pro', intelligence: 65, elo: 1468, livebench: 'gemini-3-1-pro' },
  { entity: 'Gemini 2.5 Pro', intelligence: 57, elo: 1446, livebench: 'gemini-2-5-pro' },
  { entity: 'Grok 4.1', intelligence: 60, elo: 1452, livebench: 'grok-4-1' },
  // open weights — the self-host slice builders actually compare
  { entity: 'DeepSeek-V3.2', intelligence: 54, elo: 1436, livebench: 'deepseek-v3-2' },
  { entity: 'DeepSeek V4 Pro', intelligence: 59, livebench: 'deepseek-v4' },
  { entity: 'Kimi K2', intelligence: 50, elo: 1424, livebench: 'kimi-k2' },
  { entity: 'MiniMax-M2', intelligence: 51, elo: 1428, livebench: 'minimax-m2' },
  { entity: 'Qwen3-235B', intelligence: 48, elo: 1418, livebench: 'qwen3-235b' },
  { entity: 'GLM-5.2', intelligence: 56, elo: 1439, livebench: 'glm-5' },
  { entity: 'Mistral Large 3', intelligence: 46, elo: 1408 },
  { entity: 'Llama 4 Maverick', intelligence: 44, elo: 1404 },
  // image arena (text-to-image) — our image domain
  { entity: 'GPT Image 1.5', imageElo: 1312 },
  { entity: 'Imagen 4 Ultra', imageElo: 1284 },
  { entity: 'Seedream 4.5', imageElo: 1266 },
  { entity: 'FLUX.2 Pro', imageElo: 1241 },
  { entity: 'Recraft V4', imageElo: 1218 },
  // video arena (text-to-video) — our video domain
  { entity: 'Veo 3.1', videoElo: 1296 },
  { entity: 'Sora 2 Pro', videoElo: 1271 },
  { entity: 'Kling 2.5 Turbo', videoElo: 1233 },
  { entity: 'Hailuo 2.3', videoElo: 1211 },
  { entity: 'Wan 2.5', videoElo: 1189 },
];

/** Flattens the seed table into metric points. Exported for tests. */
export function seedPoints(seeds: SeedModel[] = SEED_MODELS): MetricInput[] {
  const out: MetricInput[] = [];
  for (const m of seeds) {
    if (m.intelligence !== undefined)
      out.push({ source: 'open-bench', entity: m.entity, metric: 'intelligence', value: m.intelligence });
    if (m.elo !== undefined) out.push({ source: 'open-bench', entity: m.entity, metric: 'elo', value: m.elo });
    if (m.imageElo !== undefined)
      out.push({ source: 'open-bench', entity: m.entity, metric: 'image_elo', value: m.imageElo });
    if (m.videoElo !== undefined)
      out.push({ source: 'open-bench', entity: m.entity, metric: 'video_elo', value: m.videoElo });
  }
  return out;
}

// ── OpenRouter ───────────────────────────────────────────────────────────────

interface OpenRouterModel {
  id?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
}

/**
 * USD-per-token string/number → USD per 1M tokens. Null when absent,
 * unparseable, or negative (free models are an explicit 0, kept).
 * toPrecision(12) trims binary-float dust (3e-6 * 1e6 !== 3 exactly).
 */
function per1M(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Number((n * 1e6).toPrecision(12));
}

/** Maps the /api/v1/models payload to price points. Exported for tests. */
export function metricsFromOpenRouter(payload: unknown): MetricInput[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: MetricInput[] = [];
  for (const m of data as OpenRouterModel[]) {
    if (typeof m?.id !== 'string' || m.id.length === 0) continue;
    const priceIn = per1M(m.pricing?.prompt);
    const priceOut = per1M(m.pricing?.completion);
    if (priceIn !== null) out.push({ source: 'openrouter', entity: m.id, metric: 'price_in', value: priceIn });
    if (priceOut !== null) out.push({ source: 'openrouter', entity: m.id, metric: 'price_out', value: priceOut });
  }
  return out;
}

// ── LiveBench (live, best-effort) ────────────────────────────────────────────

/**
 * LiveBench serves a static export per release — table_<date>.csv (models ×
 * subtask scores) and categories_<date>.json (category → subtasks) — but the
 * release list exists only inside the site's JS bundle. Discovery: homepage →
 * main.*.js path → newest 20YY-MM-DD strings in the bundle, newest first.
 * Returns up to 3 underscored candidates (a spurious future date string in
 * the bundle would 404, so the caller tries them in order).
 */
export async function liveBenchReleaseCandidates(text: FetchTextFn): Promise<string[]> {
  const html = await text(`${LIVEBENCH_BASE}/`);
  const jsPath = html.match(/static\/js\/main\.[\w-]+\.js/)?.[0];
  if (!jsPath) throw new Error('livebench: main JS bundle not found on homepage');
  const js = await text(`${LIVEBENCH_BASE}/${jsPath}`);
  const dates = [...new Set([...js.matchAll(/20\d\d-\d\d-\d\d/g)].map((m) => m[0]))].sort().reverse();
  if (dates.length === 0) throw new Error('livebench: no release dates found in JS bundle');
  return dates.slice(0, 3).map((d) => d.replaceAll('-', '_'));
}

/** LiveBench's export is machine-generated: no quoting, no embedded commas. */
function parseSimpleCsv(csv: string): string[][] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(',').map((cell) => cell.trim()));
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * LiveBench global average per model: mean of per-category means (their
 * published methodology). Slugs (e.g. 'claude-opus-4-7-xhigh-effort') are
 * mapped onto seed names via each model's `livebench` prefix; a model ships
 * several rows (effort/thinking variants) — take the best published
 * configuration, as the leaderboard advertises. Rows matching no seed prefix
 * are dropped: entity naming stays vendor-public and joinable.
 */
export function liveBenchPoints(tableCsv: string, categoriesJson: string, seeds: SeedModel[] = SEED_MODELS): MetricInput[] {
  const categories = JSON.parse(categoriesJson) as Record<string, unknown>;
  const rows = parseSimpleCsv(tableCsv);
  if (rows.length < 2) return [];
  const colOf = new Map(rows[0].map((name, i) => [name, i]));

  // slug → global average across categories
  const overall = new Map<string, number>();
  for (const row of rows.slice(1)) {
    const slug = row[0];
    if (!slug) continue;
    const catMeans: number[] = [];
    for (const subtasks of Object.values(categories)) {
      if (!Array.isArray(subtasks)) continue;
      const vals: number[] = [];
      for (const st of subtasks) {
        const col = colOf.get(String(st));
        if (col === undefined) continue;
        const v = Number(row[col]);
        if (Number.isFinite(v)) vals.push(v);
      }
      if (vals.length > 0) catMeans.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    if (catMeans.length > 0) overall.set(slug, catMeans.reduce((a, b) => a + b, 0) / catMeans.length);
  }

  const out: MetricInput[] = [];
  for (const seed of seeds) {
    if (!seed.livebench) continue;
    let best: number | null = null;
    for (const [slug, score] of overall) {
      if (slug.startsWith(seed.livebench) && (best === null || score > best)) best = score;
    }
    if (best !== null) out.push({ source: 'open-bench', entity: seed.entity, metric: 'livebench', value: round2(best) });
  }
  return out;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

/**
 * Weekly sync. Failure-isolated per source: one failing source never aborts
 * the run — it lands in stats.sources with ok:false and the rest proceed.
 */
export async function runOpenBenchSync(text: FetchTextFn = fetchText): Promise<OpenBenchStats> {
  const db = getDb();
  const stats: OpenBenchStats = { recorded: 0, snapshots: 0, sources: [] };

  const audit = (source: string, raw: string) => {
    db.insert(benchmarkSnapshots)
      .values({ source, raw: raw.slice(0, RAW_SNAPSHOT_MAX), fetchedAt: new Date() })
      .run();
    stats.snapshots++;
  };
  const ok = (name: string, points: number, release?: string) =>
    stats.sources.push(release ? { name, ok: true, points, release } : { name, ok: true, points });
  const failed = (name: string, e: unknown) => {
    console.error(`[openbench] ${name} failed:`, e);
    stats.sources.push({ name, ok: false, points: 0, error: e instanceof Error ? e.message : String(e) });
  };

  // 1. OpenRouter model pricing (live, keyless)
  try {
    const raw = await text(OPENROUTER_MODELS_URL);
    const points = metricsFromOpenRouter(JSON.parse(raw));
    if (points.length === 0) throw new Error('no parseable model pricing in response');
    audit('openrouter', raw);
    stats.recorded += recordMetrics(points);
    ok('openrouter', points.length);
  } catch (e) {
    failed('openrouter', e);
  }

  // 2. LiveBench capability scores (live, best-effort static export)
  try {
    let result: { points: MetricInput[]; raw: string; release: string } | null = null;
    let lastErr: unknown = null;
    for (const candidate of await liveBenchReleaseCandidates(text)) {
      try {
        const [table, categories] = await Promise.all([
          text(`${LIVEBENCH_BASE}/table_${candidate}.csv`),
          text(`${LIVEBENCH_BASE}/categories_${candidate}.json`),
        ]);
        const points = liveBenchPoints(table, categories);
        if (points.length === 0) throw new Error('no seed-mapped models in table');
        result = { points, raw: table, release: candidate.replaceAll('_', '-') };
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!result) throw lastErr ?? new Error('no usable release');
    audit('open-bench-livebench', result.raw);
    stats.recorded += recordMetrics(result.points);
    ok('open-bench-livebench', result.points.length, result.release);
  } catch (e) {
    failed('open-bench-livebench', e);
  }

  // 3. Static seed table (primary path — review stamp lives on SEED_MODELS)
  try {
    const points = seedPoints();
    audit('open-bench-seed', JSON.stringify({ lastManualReview: '2026-08', models: SEED_MODELS }));
    stats.recorded += recordMetrics(points);
    ok('open-bench-seed', points.length);
  } catch (e) {
    failed('open-bench-seed', e);
  }

  return stats;
}
