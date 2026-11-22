/**
 * Epoch AI benchmark hub ingest — the raw material for the Radar composite
 * benchmarks (src/lib/science/composite-bench.ts).
 *
 * Epoch publishes ONE zip (https://epoch.ai/data/benchmark_data.zip, refreshed
 * daily, CC BY 4.0 — free to redistribute with credit) holding a CSV per
 * benchmark: SWE-bench Verified, Terminal-Bench, Arena WebDev Elo, CursorBench,
 * DeepSWE, FrontierSWE, GSO, SciCode, ALE-Bench, FrontierCode, MirrorCode,
 * WeirdML, GPQA, HLE, ARC-AGI-2, ... Each file's rows are one model (+ effort /
 * harness) with a score. A single benchmark is noisy and gameable; many of
 * them averaged are not, which is the whole point of the composite.
 *
 * This module only fetches + parses + records the RAW per-benchmark scores:
 *   source 'epoch-bench', metric = <spec id>, entity = model display name,
 *   value = the benchmark's own score (best row per model).
 * Normalizing and averaging happen in the composite engine, so the raw series
 * stay versioned per day and the method can change without re-fetching.
 *
 * Attribution (CC BY 4.0): EPOCH_ATTRIBUTION must be shown wherever a composite
 * built from these series is displayed.
 */
import { inflateRawSync } from 'node:zlib';
import { recordMetrics, type MetricInput } from '../metrics';
import { modelBaseName, normalizeModelKey } from '../analytics';
import { fetchWithTimeout } from './adapters/shared';

export const EPOCH_ZIP_URL = 'https://epoch.ai/data/benchmark_data.zip';
export const EPOCH_ATTRIBUTION = 'Benchmark data: Epoch AI, “Capabilities & benchmarking” (epoch.ai/benchmarks), CC BY 4.0.';

/** Only models released this recently are scored: keeps every benchmark's cohort a comparable, current one. */
export const EPOCH_WINDOW_DAYS = 400;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

export interface BenchSpec {
  /** metric key under source 'epoch-bench' */
  id: string;
  /** CSV filename inside the zip (without .csv) */
  file: string;
  /** score column (higher = better for every spec here) */
  col: string;
  label: string;
}

export const EPOCH_SPECS: BenchSpec[] = [
  // coding
  { id: 'swe_bench_verified', file: 'swe_bench_verified', col: 'Best score (across scorers)', label: 'SWE-bench Verified' },
  { id: 'terminal_bench', file: 'terminalbench_external', col: 'Accuracy mean', label: 'Terminal-Bench' },
  { id: 'webdev_arena', file: 'webdev_arena_external', col: 'Arena Score', label: 'Arena WebDev (Elo)' },
  { id: 'cursor_bench', file: 'cursorbench_external', col: 'Score', label: 'CursorBench' },
  { id: 'deepswe', file: 'deepswe_external', col: 'Pass@1', label: 'DeepSWE' },
  { id: 'frontier_swe', file: 'frontierswe_external', col: 'Score', label: 'FrontierSWE' },
  { id: 'gso', file: 'gso_external', col: 'Score OPT@1', label: 'GSO' },
  { id: 'scicode', file: 'scicode_external', col: 'Score', label: 'SciCode' },
  { id: 'ale_bench', file: 'ale_bench_external', col: 'Performance', label: 'ALE-Bench' },
  { id: 'frontier_code', file: 'frontiercode_external', col: 'Main score', label: 'FrontierCode' },
  { id: 'mirror_code', file: 'mirrorcode', col: 'mean_score', label: 'MirrorCode' },
  { id: 'weirdml', file: 'weirdml_v3_external', col: 'Score', label: 'WeirdML v3' },
  // agentic
  { id: 'vending_bench_2', file: 'vending_bench_2_external', col: 'Score', label: 'Vending-Bench 2' },
  { id: 'apex_agents', file: 'apex_agents_external', col: 'Pass@1 score', label: 'APEX-Agents' },
  // reasoning / general
  { id: 'gpqa_diamond', file: 'gpqa_diamond', col: 'Best score (across scorers)', label: 'GPQA Diamond' },
  { id: 'hle', file: 'hle_external', col: 'Accuracy', label: 'Humanity’s Last Exam' },
  { id: 'simplebench', file: 'simplebench_external', col: 'Score (AVG@5)', label: 'SimpleBench' },
  { id: 'arc_agi_2', file: 'arc_agi_2_external', col: 'Score', label: 'ARC-AGI-2' },
  { id: 'frontiermath', file: 'frontiermath_tiers_1_3_v2', col: 'Best score (across scorers)', label: 'FrontierMath T1-3' },
  { id: 'critpt', file: 'critpt_external', col: 'Accuracy', label: 'CritPt' },
];

// ── zip + csv (dependency-free) ──────────────────────────────────────────────

/** Extracts every *.csv entry of a zip (stored or deflated) as UTF-8 text. Rejects oversize entries (zip-bomb guard). */
export function unzipCsvs(buf: Buffer): Map<string, string> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('epoch: not a zip (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('epoch: corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.toLowerCase().endsWith('.csv') || name.includes('..')) continue;
    if (rawSize > MAX_ENTRY_BYTES || (total += rawSize) > MAX_TOTAL_BYTES) {
      throw new Error(`epoch: zip entry ${name} too large (${rawSize} bytes)`);
    }
    const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const comp = buf.subarray(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) data = comp;
    else if (method === 8) data = inflateRawSync(comp, { maxOutputLength: MAX_ENTRY_BYTES });
    else throw new Error(`epoch: unsupported zip compression method ${method} for ${name}`);
    out.set(name.replace(/^.*\//, '').replace(/\.csv$/i, ''), data.toString('utf8'));
  }
  return out;
}

/** RFC 4180 CSV → records keyed by header. Handles quoted fields with commas, quotes and newlines. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== '')) rows.push(row);
  const header = rows.shift();
  if (!header) return [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// ── model identity ───────────────────────────────────────────────────────────

/** 'claude-opus-5-5_max' → 'claude-opus-5-5' (Epoch ids are <model>_<effort>). */
export function epochBaseSlug(modelVersion: string): string {
  const i = modelVersion.lastIndexOf('_');
  return (i > 0 ? modelVersion.slice(0, i) : modelVersion).trim();
}

/** 'claude-opus-5-5' → 'Claude Opus 5.5' (display fallback when the CSV has no Name column). */
export function epochDisplayName(slug: string): string {
  return slug
    .replace(/(\d)-(\d)(?=-|$)/g, '$1.$2')
    .split('-')
    .filter((t) => t.length > 0)
    .map((t) => (['gpt', 'glm', 'llm', 'vl'].includes(t) ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1)))
    .join(' ');
}

/**
 * The join key for one model across sources: punctuation/case folded
 * (normalizeModelKey), effort suffix "(Max, …)" dropped, and a trailing dated
 * snapshot stamp ("-2026-03-05" / "-20260305") dropped so 'gpt-5.4-20260305'
 * and 'GPT-5.4' meet.
 */
export function benchKey(name: string): string {
  const base = modelBaseName(name).replace(/[-_ ]?20\d{2}[-_]?\d{2}[-_]?\d{2}$/, '');
  return normalizeModelKey(base);
}

// ── parse ────────────────────────────────────────────────────────────────────

export interface EpochParse {
  points: MetricInput[];
  /** per spec id: models recorded (for stats / health checks) */
  models: Record<string, number>;
  /** specs whose file or column was missing / empty — a layout change, never silent */
  failed: { id: string; error: string }[];
}

/**
 * Best score per model (rows are effort / harness / scorer variants of one
 * model), restricted to models released within EPOCH_WINDOW_DAYS of `now`.
 */
export function parseEpoch(files: Map<string, string>, now: Date = new Date(), specs: BenchSpec[] = EPOCH_SPECS): EpochParse {
  const cutoff = new Date(now.getTime() - EPOCH_WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  const out: EpochParse = { points: [], models: {}, failed: [] };
  for (const spec of specs) {
    const csv = files.get(spec.file);
    if (csv === undefined) {
      out.failed.push({ id: spec.id, error: `${spec.file}.csv missing from the zip` });
      continue;
    }
    const rows = parseCsv(csv);
    if (rows.length === 0 || !(spec.col in rows[0]!)) {
      out.failed.push({ id: spec.id, error: `column "${spec.col}" not found in ${spec.file}.csv` });
      continue;
    }
    const best = new Map<string, { name: string; score: number }>();
    for (const r of rows) {
      const released = r['Release date'] || r['Release Date'] || '';
      if (released < cutoff) continue; // also drops rows with no release date: can't be windowed
      const version = r['Model version'] || r['model_version'] || '';
      if (!version) continue;
      const score = Number(r[spec.col]);
      if (r[spec.col] === '' || !Number.isFinite(score)) continue;
      const key = benchKey(epochBaseSlug(version));
      if (key === '') continue;
      const cur = best.get(key);
      if (!cur || score > cur.score) best.set(key, { name: r['Name'] || epochDisplayName(epochBaseSlug(version)), score });
    }
    if (best.size === 0) {
      out.failed.push({ id: spec.id, error: `no recent scored rows in ${spec.file}.csv` });
      continue;
    }
    out.models[spec.id] = best.size;
    for (const { name, score } of best.values()) {
      out.points.push({ source: 'epoch-bench', entity: name, metric: spec.id, value: score });
    }
  }
  return out;
}

export type FetchBinaryFn = (url: string) => Promise<Buffer>;

const fetchBinary: FetchBinaryFn = async (url) => {
  const res = await fetchWithTimeout(url, {}, { timeoutMs: 60_000 });
  return Buffer.from(await res.arrayBuffer());
};

export type EpochStats = {
  recorded: number;
  models: Record<string, number>;
  failed: { id: string; error: string }[];
};

/**
 * Scheduled job. Records every benchmark that parsed, THEN fails the run if
 * any spec broke (renamed column, missing file) or too few parsed — so a
 * layout change shows up in job_runs instead of freezing a series quietly.
 */
export async function runEpochBenchSync(fetchBin: FetchBinaryFn = fetchBinary): Promise<EpochStats> {
  const files = unzipCsvs(await fetchBin(EPOCH_ZIP_URL));
  const parsed = parseEpoch(files);
  const recorded = recordMetrics(parsed.points);
  if (parsed.failed.length > 0) {
    throw new Error(
      `epoch-bench: ${parsed.failed.length}/${EPOCH_SPECS.length} benchmarks failed — ` +
        parsed.failed.map((f) => `${f.id} (${f.error})`).join('; '),
    );
  }
  return { recorded, models: parsed.models, failed: [] };
}
