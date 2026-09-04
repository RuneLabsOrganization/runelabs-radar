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
 *                  'provider-pricing' in/out via the shared AA-convention
 *                  blendedPrice(). Free/near-free SKUs (blended < floor) are
 *                  EXCLUDED from this input and flagged `freeSku` — their
 *                  floored CE (~capability/0.05) sits orders of magnitude
 *                  above paid models and would crush the whole cohort scale
 *   speed          'radar-speed' output_toks_per_s (nightly llm_calls rollup)
 *   momentum       mention-heat delta for the model entity (last 7 CLOSED UTC
 *                  days minus the prior 7, via entityDailySeries in
 *                  analytics.ts) — models the conversation is moving toward
 *
 * Each input is robust-scaled to 0..1 within the day's cohort (median/MAD via
 * stats.robustScale — cohort min-max let a single outlier compress the field,
 * and a model's stored value shifted when unrelated models entered or left
 * the cohort, which made the daily series non-stationary). The raw absolute
 * input is persisted next to every normalized sub-score ('*_raw' metrics) so
 * charts can plot values that stay comparable over time. A constant input
 * scales to 0.5 (no information → neutral).
 *
 * MISSING INPUTS: a model with no price or speed series (or a freeSku
 * exclusion) still scores — the composite renormalizes over the remaining
 * weights, so a model missing price+speed is effectively capability .75 /
 * momentum .25 instead of the full .45/.15. That changes what the composite
 * MEASURES per model; the effective weights are published per model as
 * `weightsUsed` in the result (and should be disclosed wherever composites
 * are ranked together).
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { llmCalls, metricPoints } from '../db/schema';
import { recordMetrics, utcDay } from '../metrics';
import { aaSnapshotModels, entityDailySeries, normalizeModelKey } from '../analytics';
import { canonicalEntityKey } from '../entity';
import { blendedPrice } from '../market-price';
import { robustScale } from '../stats';

// v1 weights — tunable after calibration (§6e checklist)
const WEIGHTS = { capability: 0.45, costEfficiency: 0.25, speed: 0.15, momentum: 0.15 } as const;

type RadarScoreInput = keyof typeof WEIGHTS;

/**
 * $/1M threshold below which a model counts as a free/near-free SKU: excluded
 * from the cost-efficiency cohort (flagged separately) instead of dividing by
 * a floored denominator and distorting the scale for every paid model.
 */
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

/** Mention-heat window: 15 fetched days = today (partial, dropped) + 14 closed. */
const MOMENTUM_FETCH_DAYS = 15;

const DAY_MS = 864e5;

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Methodology blurb shipped with every result so the trust page can disclose
 * what the composite means without re-deriving it from source.
 */
const METHODOLOGY =
  'Radar Score = weighted mean of robust-scaled inputs (median/MAD within the day’s cohort; ' +
  '0.5 = typical, NOT min-max, so one outlier cannot compress the field). v1 weights: ' +
  'capability .45, cost-efficiency .25, speed .15, momentum .15. Models missing an input ' +
  '(no price/speed series, or a free SKU excluded from the cost-efficiency scale) are scored ' +
  'on the remaining inputs with weights renormalized to sum to 1 — see per-model weightsUsed; ' +
  'composites of models with different weightsUsed measure slightly different things.';

export interface RadarScoreModel {
  entity: string;
  composite: number;
  /** Effective weights after missing-input renormalization (sum to 1). */
  weightsUsed: Partial<Record<RadarScoreInput, number>>;
  /** Inputs absent from the composite (renormalized out of the weights). */
  missing: RadarScoreInput[];
  /** Blended price sat below the free-SKU threshold — excluded from the cost-efficiency cohort. */
  freeSku: boolean;
  /**
   * Only one side of the in/out price was known, so it stood in for the whole
   * blend — output prices run ~3–4× input, making the blend (and the derived
   * cost-efficiency) biased. UIs comparing across models should disclose it.
   */
  singleSided: boolean;
}

export interface RadarScoreResult {
  scored: number;
  models: RadarScoreModel[];
  methodology: string;
}

/**
 * Latest value per entity for one (source, metric) with date ≤ asOf.
 * Explicit self-join on the per-entity max date — the old bare-column-with-
 * MAX() grouping relied on SQLite resolving `value` from the max(date) row,
 * which is documented only as a side effect of min/max aggregation. The
 * (source, entity, metric, date) upsert key keeps the join from fanning out.
 */
function latestValues(source: string, metric: string, asOf: string): Map<string, number> {
  const db = getDb();
  const latest = db
    .select({
      entity: metricPoints.entity,
      latestDate: sql<string>`max(${metricPoints.date})`.as('latest_date'),
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
    .as('latest');
  const rows = db
    .select({ entity: metricPoints.entity, value: metricPoints.value })
    .from(metricPoints)
    .innerJoin(
      latest,
      and(eq(metricPoints.entity, latest.entity), eq(metricPoints.date, latest.latestDate)),
    )
    .where(and(eq(metricPoints.source, source), eq(metricPoints.metric, metric)))
    .all();
  return new Map(rows.map((r) => [r.entity, r.value]));
}

/**
 * Nightly speed rollup (§7a double-duty): per model,
 * output_toks_per_s = sum(completionTokens) / sum(durationMs) * 1000 over the
 * trailing SPEED_WINDOW_DAYS ending on `date` → metric_points
 * (source 'radar-speed', metric 'output_toks_per_s'). Registered at the END
 * of the science job so the composite below can read it the same night.
 *
 * NOTE: entities here are raw llm_calls.model API ids; computeRadarScores
 * bridges them to display names via normalizeModelKey.
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
  freeSku: boolean;
  singleSided: boolean;
  speed: number | null;
  momentum: number;
}

/**
 * Compute the Radar Score for every model with an open-bench intelligence
 * value as of `date` and write the rows:
 *   source 'radar-score', metric 'composite' | 'capability' | 'cost_efficiency'
 *   | 'speed' | 'momentum' — sub-scores stored separately (robust-scaled 0..1)
 *   plus the raw absolute input under '<metric>_raw' so charts can use values
 *   that stay comparable over time. Sub-scores for missing inputs are simply
 *   not written.
 *
 * Divergence logging (always on): for models having both a composite and AA
 * intelligence (latest stored snapshot), also writes
 *   source 'radar-score', metric 'aa_divergence', value =
 *   robustScale(composite over the overlap cohort) − robustScale(AA
 *   intelligence over the same overlap cohort)  ∈ [-1, 1].
 * Positive = Radar ranks the model higher than AA does. ("Same day" reads as
 * the latest AA snapshot available on `date` — snapshots are weekly while
 * scoring is nightly.)
 *
 * Momentum is as-of-now regardless of `date` (mention series aren't
 * backfilled); all other inputs honor the as-of date.
 */
export function computeRadarScores(date: string = utcDay()): RadarScoreResult {
  const intelligence = latestValues('open-bench', 'intelligence', date);
  if (intelligence.size === 0) return { scored: 0, models: [], methodology: METHODOLOGY };
  const evalScores = latestValues('radar-eval', RADAR_EVAL_METRIC, date);
  const priceIn = latestValues('provider-pricing', 'price_in', date);
  const priceOut = latestValues('provider-pricing', 'price_out', date);
  const speed = latestValues('radar-speed', 'output_toks_per_s', date);

  const entities = [...intelligence.keys()];
  // 15 days so 14 CLOSED UTC days remain after dropping today's partial day:
  // the job runs intraday, and counting today would bias "recent 7d" downward
  // by an amount that varies with run time.
  const heat = entityDailySeries(entities, MOMENTUM_FETCH_DAYS);

  // rollupModelSpeed keys the speed series by raw llm_calls.model API ids —
  // bridge to open-bench display names with the same normalizeModelKey join
  // the AA backstop uses, or the input silently renormalizes out wherever
  // the two strings differ.
  const speedByKey = new Map<string, number>();
  for (const [model, v] of speed) {
    const key = normalizeModelKey(model);
    if (key !== '') speedByKey.set(key, v);
  }

  const raws: RawInputs[] = entities.map((entity) => {
    const intel = intelligence.get(entity)!;
    const evalScore = evalScores.get(entity);
    // blend activates only when the radar-eval series exists for this model
    const capability =
      evalScore !== undefined ? RADAR_EVAL_WEIGHT * evalScore + (1 - RADAR_EVAL_WEIGHT) * intel : intel;
    const { price, singleSided } = blendedPrice(priceIn.get(entity) ?? null, priceOut.get(entity) ?? null);
    const freeSku = price !== null && price < PRICE_FLOOR_USD;
    // free/near-free SKUs join the composite WITHOUT cost-efficiency (flagged
    // freeSku) rather than crushing the cohort scale from a floored denominator
    const costEfficiency = price !== null && !freeSku ? capability / Math.max(price, PRICE_FLOOR_USD) : null;
    const series = heat.get(canonicalEntityKey(entity)) ?? [];
    const closed = series.slice(0, -1); // drop today's partial day
    // mention-heat delta: last 7 closed days minus the prior 7
    const momentum =
      closed.slice(-7).reduce((a, b) => a + b, 0) - closed.slice(-14, -7).reduce((a, b) => a + b, 0);
    return {
      entity,
      capability,
      costEfficiency,
      freeSku,
      singleSided,
      speed: speedByKey.get(normalizeModelKey(entity)) ?? null,
      momentum,
    };
  });

  const capabilityCohort = raws.map((r) => r.capability);
  const momentumCohort = raws.map((r) => r.momentum);
  const ceCohort = raws.filter((r) => r.costEfficiency !== null).map((r) => r.costEfficiency!);
  const spCohort = raws.filter((r) => r.speed !== null).map((r) => r.speed!);

  const points: { source: string; entity: string; metric: string; value: number; date: string }[] = [];
  const composites: { entity: string; composite: number }[] = [];
  const models: RadarScoreModel[] = [];
  for (const r of raws) {
    const parts: { key: RadarScoreInput; w: number; v: number }[] = [
      { key: 'capability', w: WEIGHTS.capability, v: robustScale(r.capability, capabilityCohort) },
      { key: 'momentum', w: WEIGHTS.momentum, v: robustScale(r.momentum, momentumCohort) },
    ];
    if (r.costEfficiency !== null) parts.push({ key: 'costEfficiency', w: WEIGHTS.costEfficiency, v: robustScale(r.costEfficiency, ceCohort) });
    if (r.speed !== null) parts.push({ key: 'speed', w: WEIGHTS.speed, v: robustScale(r.speed, spCohort) });
    // missing inputs renormalize over the remaining weights — the effective
    // weights go out as weightsUsed so consumers can disclose that composites
    // of models with different missing inputs measure different things
    const weightSum = parts.reduce((a, p) => a + p.w, 0);
    const composite = parts.reduce((a, p) => a + p.w * p.v, 0) / weightSum;
    composites.push({ entity: r.entity, composite });

    const weightsUsed: Partial<Record<RadarScoreInput, number>> = {};
    for (const p of parts) weightsUsed[p.key] = round4(p.w / weightSum);
    const present = new Set(parts.map((p) => p.key));
    const missing = (Object.keys(WEIGHTS) as RadarScoreInput[]).filter((k) => !present.has(k));
    models.push({
      entity: r.entity,
      composite: round4(composite),
      weightsUsed,
      missing,
      freeSku: r.freeSku,
      singleSided: r.singleSided,
    });

    const put = (metric: string, value: number) =>
      points.push({ source: 'radar-score', entity: r.entity, metric, value: round4(value), date });
    const byKey = (key: RadarScoreInput) => parts.find((p) => p.key === key);
    put('composite', composite);
    put('capability', byKey('capability')!.v);
    put('capability_raw', r.capability);
    put('momentum', byKey('momentum')!.v);
    put('momentum_raw', r.momentum);
    if (r.costEfficiency !== null) {
      put('cost_efficiency', byKey('costEfficiency')!.v);
      put('cost_efficiency_raw', r.costEfficiency);
    }
    if (r.speed !== null) {
      put('speed', byKey('speed')!.v);
      put('speed_raw', r.speed);
    }
  }

  // divergence vs AA (always on — the calibration signal for the v1 weights)
  const aa = aaSnapshotModels();
  const aaByKey = new Map(aa.map((m) => [normalizeModelKey(m.name), m.intelligence]));
  const overlap = composites.filter((c) => aaByKey.has(normalizeModelKey(c.entity)));
  if (overlap.length > 0) {
    const compositeCohort = overlap.map((c) => c.composite);
    const aaCohort = overlap.map((c) => aaByKey.get(normalizeModelKey(c.entity))!);
    for (let i = 0; i < overlap.length; i++) {
      points.push({
        source: 'radar-score',
        entity: overlap[i]!.entity,
        metric: 'aa_divergence',
        value: round4(robustScale(compositeCohort[i]!, compositeCohort) - robustScale(aaCohort[i]!, aaCohort)),
        date,
      });
    }
  }

  recordMetrics(points);
  return { scored: composites.length, models, methodology: METHODOLOGY };
}
