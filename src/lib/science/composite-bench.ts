/**
 * Radar composite benchmarks — OUR average over MANY benchmarks per capability.
 *
 * Benchmarking is the weak point of AI evaluation: any single benchmark is
 * noisy, saturates, gets contaminated or gamed. The composite leans on the law
 * of large numbers instead: take every independent benchmark we can get for a
 * capability (coding: 12 Epoch AI benchmarks + LiveBench's coding suite),
 * normalize each against ITS OWN current cohort, and average. One bad or gamed
 * benchmark moves the result by 1/n.
 *
 * Method (all choices deliberate, kept simple enough to audit):
 *   1. Per benchmark, take the latest score per model (series ≤ date, no older
 *      than MAX_AGE_DAYS so a model a benchmark stopped updating drops out).
 *   2. Normalize with the cohort's median/MAD (stats.robustScale → 0..1, 0.5 =
 *      typical model, outlier-resistant). Models are compared with the models
 *      the SAME benchmark scored; Elo, percent and pass-rate scales all become
 *      comparable. A benchmark with fewer than MIN_COHORT models is dropped.
 *   3. A model needs MIN_SOURCES benchmarks to get a score at all.
 *   4. Mean of its normalized scores, shrunk toward the 0.5 centre with
 *      SHRINK_K pseudo-observations — a model measured on 3 benchmarks cannot
 *      out-rank one measured on 10 with the same average on thin evidence.
 *   5. Leave-one-out stability: the largest move in the score if any ONE
 *      benchmark is removed. Large = the score hinges on a single benchmark.
 *
 * Inputs are CC BY (Epoch AI) / open (LiveBench) only — no Artificial Analysis
 * data — so composites are safe to publish; EPOCH_ATTRIBUTION must accompany
 * them. Output: source 'radar-bench', metric '<capability>' (0-100),
 * '<capability>_n' (benchmarks used) and '<capability>_stability' (0-100 points).
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { metricPoints } from '../db/schema';
import { recordMetrics, utcDay, type MetricInput } from '../metrics';
import { collapseVariants, freshAaModels, modelBaseName } from '../analytics';
import { benchKey, EPOCH_ATTRIBUTION, EPOCH_SPECS, epochDisplayName } from '../ingest/epoch-bench';
import { robustScale } from '../stats';
import { latestValues } from './score';

export type Capability = 'coding' | 'agentic' | 'reasoning';

interface SourceRef {
  source: string;
  metric: string;
  label: string;
}

const epoch = (id: string): SourceRef => {
  const spec = EPOCH_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`composite-bench: unknown Epoch benchmark ${id}`);
  return { source: 'epoch-bench', metric: id, label: spec.label };
};
const liveBench = (suite: string, label: string): SourceRef => ({
  source: 'open-bench',
  metric: `livebench_${suite}`,
  label: `LiveBench ${label}`,
});

export const COMPOSITES: Record<Capability, { label: string; sources: SourceRef[] }> = {
  coding: {
    label: 'Coding',
    sources: [
      epoch('swe_bench_verified'),
      epoch('terminal_bench'),
      epoch('webdev_arena'),
      epoch('cursor_bench'),
      epoch('deepswe'),
      epoch('frontier_swe'),
      epoch('gso'),
      epoch('scicode'),
      epoch('ale_bench'),
      epoch('frontier_code'),
      epoch('mirror_code'),
      epoch('weirdml'),
      liveBench('coding', 'coding'),
    ],
  },
  agentic: {
    label: 'Agentic',
    sources: [
      epoch('terminal_bench'),
      epoch('vending_bench_2'),
      epoch('apex_agents'),
      epoch('deepswe'),
      epoch('frontier_swe'),
      liveBench('long_agentic', 'long agentic'),
      liveBench('browser', 'browser'),
    ],
  },
  reasoning: {
    label: 'General reasoning',
    sources: [
      epoch('gpqa_diamond'),
      epoch('hle'),
      epoch('simplebench'),
      epoch('arc_agi_2'),
      epoch('frontiermath'),
      epoch('critpt'),
      liveBench('reasoning', 'reasoning'),
    ],
  },
};

export const CAPABILITIES = Object.keys(COMPOSITES) as Capability[];

/** A benchmark scoring fewer models than this has no cohort worth normalizing against. */
const MIN_COHORT = 8;
/** Benchmarks a model needs before it gets a composite at all. */
const MIN_SOURCES = 3;
/** Pseudo-observations at the 0.5 centre mixed into every mean (thin coverage → pulled to the middle). */
const SHRINK_K = 1;
/** Leave-one-out swing (0..1 scale) above which a score is flagged as resting on a single benchmark. */
export const STABILITY_FLAG = 0.15;
/** A benchmark value older than this no longer counts (Epoch re-records current models daily). */
const MAX_AGE_DAYS = 30;

export const BENCH_METHODOLOGY =
  'Composite = average of each model’s standing across many independent benchmarks. Every benchmark is ' +
  'normalized against its own current cohort (median/MAD, so Elo, percent and pass-rate scales compare), ' +
  'a model needs at least ' +
  MIN_SOURCES +
  ' benchmarks to be scored, and the average is shrunk toward the middle for thin coverage. ' +
  'No single benchmark can decide a rank; “stability” shows how far the score moves if any one benchmark is dropped. ' +
  EPOCH_ATTRIBUTION;

export interface BenchModel {
  entity: string;
  /** 0-100 */
  score: number;
  /** benchmarks that contributed */
  n: number;
  /** largest leave-one-out swing, 0-100 points (null when n is too small to leave one out) */
  stability: number | null;
  unstable: boolean;
  /** per-benchmark normalized standing, 0..1 */
  parts: { label: string; z: number }[];
}

export interface BenchCompositeResult {
  capability: Capability;
  scored: number;
  models: BenchModel[];
  /** benchmarks that made it into this run, with the cohort each was normalized against */
  sources: { label: string; models: number }[];
  /** configured benchmarks dropped for lack of data (never silent) */
  dropped: { label: string; models: number }[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function shrunkMean(zs: number[]): number {
  return (zs.reduce((a, b) => a + b, 0) + SHRINK_K * 0.5) / (zs.length + SHRINK_K);
}

/** Prefer a properly cased, spaced name ("Claude Opus 5.5") over a raw slug ("claude-opus-5-5"); ties keep the first seen. */
function niceness(name: string): number {
  return (/\s/.test(modelBaseName(name)) ? 2 : 0) + (/[A-Z]/.test(name) ? 1 : 0);
}

/** Tidy a raw source name: effort suffix dropped, slugs turned into words. */
function tidyName(name: string): string {
  const base = modelBaseName(name);
  return /\s/.test(base) ? base : epochDisplayName(base);
}

/** Display names: the AA base name when AA lists the model (it is what the rest of the site shows), else the source's own. */
function displayResolver(): (key: string, fallback: string) => string {
  const aa = new Map<string, string>();
  const fresh = freshAaModels();
  if (fresh) for (const m of collapseVariants(fresh.models)) aa.set(benchKey(m.name), modelBaseName(m.name));
  return (key, fallback) => aa.get(key) ?? fallback;
}

export function computeBenchComposite(capability: Capability, date: string = utcDay()): BenchCompositeResult {
  const since = utcDay(new Date(Date.parse(`${date}T00:00:00Z`) - MAX_AGE_DAYS * 864e5));
  const names = new Map<string, string>();
  const byModel = new Map<string, { label: string; z: number }[]>();
  const result: BenchCompositeResult = { capability, scored: 0, models: [], sources: [], dropped: [] };

  for (const ref of COMPOSITES[capability].sources) {
    // several entity spellings can share one join key: keep the best score
    const best = new Map<string, number>();
    for (const [entity, value] of latestValues(ref.source, ref.metric, date, since)) {
      const key = benchKey(entity);
      if (key === '') continue;
      if (!names.has(key) || niceness(entity) > niceness(names.get(key)!)) names.set(key, entity);
      if ((best.get(key) ?? -Infinity) < value) best.set(key, value);
    }
    if (best.size < MIN_COHORT) {
      result.dropped.push({ label: ref.label, models: best.size });
      continue;
    }
    const cohort = [...best.values()];
    result.sources.push({ label: ref.label, models: best.size });
    for (const [key, v] of best) {
      const list = byModel.get(key) ?? [];
      list.push({ label: ref.label, z: robustScale(v, cohort) });
      byModel.set(key, list);
    }
  }

  const display = displayResolver();
  for (const [key, parts] of byModel) {
    if (parts.length < MIN_SOURCES) continue;
    const zs = parts.map((p) => p.z);
    const composite = shrunkMean(zs);
    let swing: number | null = null;
    if (parts.length > MIN_SOURCES) {
      swing = Math.max(...zs.map((_, i) => Math.abs(composite - shrunkMean(zs.filter((__, j) => j !== i)))));
    }
    result.models.push({
      entity: display(key, tidyName(names.get(key) ?? key)),
      score: round2(composite * 100),
      n: parts.length,
      stability: swing === null ? null : round2(swing * 100),
      unstable: swing !== null && swing > STABILITY_FLAG,
      parts: parts.map((p) => ({ label: p.label, z: round2(p.z) })),
    });
  }
  result.models.sort((a, b) => b.score - a.score);
  result.scored = result.models.length;
  return result;
}

/** Computes + stores every capability's composite. Called at the end of the nightly science job. */
export function computeAllComposites(date: string = utcDay()): Record<Capability, number> {
  const out = {} as Record<Capability, number>;
  const points: MetricInput[] = [];
  for (const capability of CAPABILITIES) {
    const res = computeBenchComposite(capability, date);
    out[capability] = res.scored;
    for (const m of res.models) {
      points.push({ source: 'radar-bench', entity: m.entity, metric: capability, value: m.score, date });
      points.push({ source: 'radar-bench', entity: m.entity, metric: `${capability}_n`, value: m.n, date });
      if (m.stability !== null) {
        points.push({ source: 'radar-bench', entity: m.entity, metric: `${capability}_stability`, value: m.stability, date });
      }
    }
  }
  recordMetrics(points);
  return out;
}

export interface StoredBenchModel {
  entity: string;
  score: number;
  n: number;
  stability: number | null;
  unstable: boolean;
}

/** Latest stored composite for a capability (the board prompt and the tools page read this), best first. */
export function latestBenchComposite(capability: Capability): { date: string | null; models: StoredBenchModel[] } {
  const db = getDb();
  const newest = db
    .select({ date: metricPoints.date })
    .from(metricPoints)
    .where(and(eq(metricPoints.source, 'radar-bench'), eq(metricPoints.metric, capability)))
    .orderBy(desc(metricPoints.date))
    .limit(1)
    .get();
  if (!newest) return { date: null, models: [] };
  const rows = db
    .select({ entity: metricPoints.entity, metric: metricPoints.metric, value: metricPoints.value })
    .from(metricPoints)
    .where(and(eq(metricPoints.source, 'radar-bench'), eq(metricPoints.date, newest.date)))
    .all()
    .filter((r) => r.metric === capability || r.metric === `${capability}_n` || r.metric === `${capability}_stability`);
  const by = new Map<string, StoredBenchModel>();
  for (const r of rows) {
    const cur = by.get(r.entity) ?? { entity: r.entity, score: 0, n: 0, stability: null, unstable: false };
    if (r.metric === capability) cur.score = r.value;
    else if (r.metric === `${capability}_n`) cur.n = r.value;
    else {
      cur.stability = r.value;
      cur.unstable = r.value > STABILITY_FLAG * 100;
    }
    by.set(r.entity, cur);
  }
  return { date: newest.date, models: [...by.values()].filter((m) => m.n > 0).sort((a, b) => b.score - a.score) };
}

/** Prompt block for the board-proposal LLM: top models by multi-benchmark composite, with the evidence depth. */
export function benchPromptLines(capability: Capability, limit = 15): string | null {
  const { models } = latestBenchComposite(capability);
  if (models.length === 0) return null;
  return models
    .slice(0, limit)
    .map(
      (m) =>
        `- ${m.entity}: ${m.score} (${m.n} benchmarks${m.unstable ? ', score hinges on one benchmark' : ''})`,
    )
    .join('\n');
}

/**
 * The scheduled job. A composite that scores nobody means the inputs vanished
 * (an ingest broke, a benchmark file moved) — that must fail the run, not
 * leave yesterday's numbers quietly standing in for today's.
 */
export function runBenchComposites(): Record<Capability, number> {
  const counts = computeAllComposites();
  const empty = CAPABILITIES.filter((c) => counts[c] === 0);
  if (empty.length > 0) {
    throw new Error(`bench-composite: no models scored for ${empty.join(', ')} — benchmark inputs missing or too thin`);
  }
  return counts;
}
