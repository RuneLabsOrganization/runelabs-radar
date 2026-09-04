/**
 * Radar Score (§6e) — our own model composite, computed only from series we
 * own, versioned daily in metric_points so the explorer can chart components
 * and the weights can be re-evaluated historically.
 *
 * Ships DARK: the pipeline (speed rollup + composite + AA divergence) runs
 * every night, but consumers only switch to it under RADAR_SCORE_CONSUMERS
 * (config.radarScoreConsumers) after 2-4 weeks of divergence review.
 *
 * Inputs (all as-of the scored date, latest series value ≤ date):
 *   capability     open-bench 'intelligence' (0-100), blended with the
 *                  'radar-eval' series when that exists for the model (§6c —
 *                  dormant until the eval suite ships)
 *   costEfficiency capability / max(price_blended, floor); price from
 *                  'provider-pricing' in/out, blended PRICE_BLEND_IN:(1-w)
 *   speed          'radar-speed' output_toks_per_s (nightly llm_calls rollup)
 *   momentum       mention-heat delta for the model entity (recent 7d minus
 *                  prior 7d, via entityDailySeries in analytics.ts) — models
 *                  the conversation is moving toward
 *
 * Each input is min-max normalized to 0..1 within the day's cohort. A model
 * with a MISSING input still scores: the composite renormalizes over the
 * remaining weights (documented below). A constant input normalizes to 0.5
 * (no information → neutral).
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { llmCalls, metricPoints } from '../db/schema';
import { recordMetrics, utcDay } from '../metrics';
import { aaSnapshotModels, entityDailySeries, normalizeModelKey } from '../analytics';
import { canonicalEntityKey } from '../entity';
import { blendedPrice } from '../market-price';

// v1 weights — tunable after calibration (§6e checklist)
const WEIGHTS = { capability: 0.45, costEfficiency: 0.25, speed: 0.15, momentum: 0.15 } as const;
// costEfficiency = capability / max(price_blended, floor) — floored to avoid div-by-zero on free models

/** $/1M floor on the cost-efficiency denominator: free/0-priced models can't divide by zero or score infinite value. */
const PRICE_FLOOR_USD = 0.05;

/**
 * Share of the capability score given to our own radar-eval result when that
 * series has data for the model (§6c; dormant until the suite ships). Assumes
 * radar-eval 'score' is on the same 0-100 scale as open-bench intelligence.
 */
const RADAR_EVAL_WEIGHT = 0.5;

/** Metric key the §6c eval suite will write under source 'radar-eval'. */
const RADAR_EVAL_METRIC = 'score';

/** Trailing window for the speed rollup — smooths single-call noise. */
const SPEED_WINDOW_DAYS = 7;

const DAY_MS = 864e5;

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Latest value per entity for one (source, metric) with date ≤ asOf. */
function latestValues(source: string, metric: string, asOf: string): Map<string, number> {
  const db = getDb();
  // SQLite resolves the bare `value` column from each group's max(date) row
  const rows = db
    .select({
      entity: metricPoints.entity,
      value: metricPoints.value,
      latest: sql<string>`max(${metricPoints.date})`,
    })
    .from(metricPoints)
    .where(
      and(
        eq(metricPoints.source, source),
        eq(metricPoints.metric, metric),
        sql`${metricPoints.date} <= ${asOf}`,
      ),
    )
    .groupBy(metricPoints.entity)
    .all();
  return new Map(rows.map((r) => [r.entity, r.value]));
}

/** Min-max to 0..1; a constant input maps to 0.5 (no information → neutral). */
export function normalizeCohort(values: number[]): number[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi === lo) return values.map(() => 0.5);
  return values.map((v) => (v - lo) / (hi - lo));
}

/**
 * Nightly speed rollup (§7a double-duty): per model,
 * output_toks_per_s = sum(completionTokens) / sum(durationMs) * 1000 over the
 * trailing SPEED_WINDOW_DAYS ending on `date` → metric_points
 * (source 'radar-speed', metric 'output_toks_per_s'). Registered at the END
 * of the science job so the composite below can read it the same night.
 */
export function rollupModelSpeed(date: string = utcDay()): { models: number } {
  const db = getDb();
  const end = new Date(`${date}T00:00:00Z`).getTime() + DAY_MS;
  const start = end - SPEED_WINDOW_DAYS * DAY_MS;
  const rows = db
    .select({
      model: llmCalls.model,
      toks: sql<number>`sum(${llmCalls.completionTokens})`,
      ms: sql<number>`sum(${llmCalls.durationMs})`,
    })
    .from(llmCalls)
    .where(and(gte(llmCalls.ts, new Date(start)), lt(llmCalls.ts, new Date(end))))
    .groupBy(llmCalls.model)
    .all();
  const points = rows
    .filter((r) => r.ms > 0 && r.toks > 0)
    .map((r) => ({
      source: 'radar-speed',
      entity: r.model,
      metric: 'output_toks_per_s',
      value: (r.toks / r.ms) * 1000,
      date,
    }));
  recordMetrics(points);
  return { models: points.length };
}

interface RawInputs {
  entity: string;
  capability: number;
  costEfficiency: number | null;
  speed: number | null;
  momentum: number;
}

/**
 * Compute the Radar Score for every model with an open-bench intelligence
 * value as of `date` and write the rows:
 *   source 'radar-score', metric 'composite' | 'capability' | 'cost_efficiency'
 *   | 'speed' | 'momentum' — sub-scores stored separately (normalized 0..1) so
 *   the explorer can chart components and weights can be re-evaluated later.
 * Sub-scores for missing inputs are simply not written.
 *
 * Divergence logging (always on): for models having both a composite and AA
 * intelligence (latest stored snapshot), also writes
 *   source 'radar-score', metric 'aa_divergence', value =
 *   minmax(composite over the overlap cohort) − minmax(AA intelligence over
 *   the same overlap cohort)  ∈ [-1, 1].
 * Positive = Radar ranks the model higher than AA does. ("Same day" reads as
 * the latest AA snapshot available on `date` — snapshots are weekly while
 * scoring is nightly.)
 *
 * Momentum is as-of-now regardless of `date` (mention series aren't
 * backfilled); all other inputs honor the as-of date.
 */
export function computeRadarScores(date: string = utcDay()): { scored: number } {
  const intelligence = latestValues('open-bench', 'intelligence', date);
  if (intelligence.size === 0) return { scored: 0 };
  const evalScores = latestValues('radar-eval', RADAR_EVAL_METRIC, date);
  const priceIn = latestValues('provider-pricing', 'price_in', date);
  const priceOut = latestValues('provider-pricing', 'price_out', date);
  const speed = latestValues('radar-speed', 'output_toks_per_s', date);

  const entities = [...intelligence.keys()];
  const heat = entityDailySeries(entities, 14);

  const raws: RawInputs[] = entities.map((entity) => {
    const intel = intelligence.get(entity)!;
    const evalScore = evalScores.get(entity);
    // blend activates only when the radar-eval series exists for this model
    const capability =
      evalScore !== undefined ? RADAR_EVAL_WEIGHT * evalScore + (1 - RADAR_EVAL_WEIGHT) * intel : intel;
    const pIn = priceIn.get(entity) ?? null;
    const pOut = priceOut.get(entity) ?? null;
    const blended = blendedPrice(pIn, pOut).price ?? undefined;
    const costEfficiency = blended !== undefined ? capability / Math.max(blended, PRICE_FLOOR_USD) : null;
    const series = heat.get(canonicalEntityKey(entity)) ?? [];
    // mention-heat delta: recent 7 days minus prior 7 days
    const momentum =
      series.slice(7).reduce((a, b) => a + b, 0) - series.slice(0, 7).reduce((a, b) => a + b, 0);
    return { entity, capability, costEfficiency, speed: speed.get(entity) ?? null, momentum };
  });

  const normCapability = normalizeCohort(raws.map((r) => r.capability));
  const cePresent = raws.map((r, i) => ({ r, i })).filter((x) => x.r.costEfficiency !== null);
  const normCe = normalizeCohort(cePresent.map((x) => x.r.costEfficiency!));
  const spPresent = raws.map((r, i) => ({ r, i })).filter((x) => x.r.speed !== null);
  const normSp = normalizeCohort(spPresent.map((x) => x.r.speed!));
  const normMomentum = normalizeCohort(raws.map((r) => r.momentum));

  const ceNormByIdx = new Map(cePresent.map((x, j) => [x.i, normCe[j]!]));
  const spNormByIdx = new Map(spPresent.map((x, j) => [x.i, normSp[j]!]));

  const points: { source: string; entity: string; metric: string; value: number; date: string }[] = [];
  const composites: { entity: string; composite: number }[] = [];
  for (let i = 0; i < raws.length; i++) {
    const r = raws[i]!;
    const parts: { w: number; v: number }[] = [
      { w: WEIGHTS.capability, v: normCapability[i]! },
      { w: WEIGHTS.momentum, v: normMomentum[i]! },
    ];
    const ce = ceNormByIdx.get(i);
    if (ce !== undefined) parts.push({ w: WEIGHTS.costEfficiency, v: ce });
    const sp = spNormByIdx.get(i);
    if (sp !== undefined) parts.push({ w: WEIGHTS.speed, v: sp });
    // missing inputs renormalize over the remaining weights
    const weightSum = parts.reduce((a, p) => a + p.w, 0);
    const composite = parts.reduce((a, p) => a + p.w * p.v, 0) / weightSum;
    composites.push({ entity: r.entity, composite });

    const put = (metric: string, value: number) =>
      points.push({ source: 'radar-score', entity: r.entity, metric, value: round4(value), date });
    put('composite', composite);
    put('capability', normCapability[i]!);
    if (ce !== undefined) put('cost_efficiency', ce);
    if (sp !== undefined) put('speed', sp);
    put('momentum', normMomentum[i]!);
  }

  // divergence vs AA (always on — the calibration signal for the v1 weights)
  const aa = aaSnapshotModels();
  const aaByKey = new Map(aa.map((m) => [normalizeModelKey(m.name), m.intelligence]));
  const overlap = composites.filter((c) => aaByKey.has(normalizeModelKey(c.entity)));
  if (overlap.length > 0) {
    const normComposite = normalizeCohort(overlap.map((c) => c.composite));
    const normAa = normalizeCohort(overlap.map((c) => aaByKey.get(normalizeModelKey(c.entity))!));
    for (let i = 0; i < overlap.length; i++) {
      points.push({
        source: 'radar-score',
        entity: overlap[i]!.entity,
        metric: 'aa_divergence',
        value: round4(normComposite[i]! - normAa[i]!),
        date,
      });
    }
  }

  recordMetrics(points);
  return { scored: composites.length };
}
