import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import { getDb, type Db } from '@/lib/db';
import { benchmarkSnapshots, llmCalls, metricPoints, stories } from '@/lib/db/schema';
import { recordMetrics, utcDay } from '@/lib/metrics';
import { computeRadarScores, rollupModelSpeed } from '@/lib/science/score';

vi.mock('@/lib/llm/minimax', () => ({
  chatJSON: vi.fn(),
  drainLlmUsageStats: () => ({ calls: 0, promptTokens: 0, completionTokens: 0 }),
  LlmError: class LlmError extends Error {},
}));
// eslint-disable-next-line import/first
import { runScience } from '@/lib/science/run';

const DAY = 864e5;

function scoreRows(metric: string): Map<string, number> {
  const rows = getDb()
    .select({ entity: metricPoints.entity, value: metricPoints.value })
    .from(metricPoints)
    .where(and(eq(metricPoints.source, 'radar-score'), eq(metricPoints.metric, metric)))
    .all();
  return new Map(rows.map((r) => [r.entity, r.value]));
}

function insertMention(db: Db, name: string, daysAgo: number): void {
  db.insert(stories)
    .values({
      title: `${name} story ${Math.random()}`,
      status: 'curated',
      topScore: 50,
      entities: JSON.stringify([{ name, kind: 'model' }]),
      createdAt: new Date(Date.now() - daysAgo * DAY),
    })
    .run();
}

function seedAaSnapshot(models: Record<string, unknown>[]): void {
  getDb()
    .insert(benchmarkSnapshots)
    .values({ source: 'artificial-analysis', raw: JSON.stringify({ compact: true, models }), fetchedAt: new Date() })
    .run();
}

beforeEach(() => {
  useTestDb();
});

describe('computeRadarScores (§6e)', () => {
  /**
   * Hand-computed fixture (robust scale: 0.5 + 0.5·tanh(z/3), z = (v−median)/MAD;
   * ±1 MAD → hi 0.6608 / lo 0.3392 — these REPLACE the old min-max expectations
   * because cohort min-max let one outlier compress the field and made stored
   * values non-stationary as the cohort changed):
   *   capability  Alpha 80, Beta 60, Gamma 40   → median 60, MAD 20 → hi, 0.5, lo
   *   price blend Alpha 8 ($8/$8), Beta 3 ($2/$6) → costEff 10, 20 → lo, hi; Gamma missing
   *   speed       Alpha 100, Beta 50            → hi, lo; Gamma missing
   *   momentum    Alpha +1, Beta -1, Gamma 0    → hi, lo, 0.5
   * composites: Alpha .45·hi+.25·lo+.15·hi+.15·hi = 0.5804
   *             Beta  .45·.5+.25·hi+.15·lo+.15·lo = 0.492
   *             Gamma (.45·lo+.15·.5)/(.45+.15)  = 0.3794 (missing inputs renormalize)
   */
  function seedFixture(): void {
    recordMetrics([
      { source: 'open-bench', entity: 'Alpha', metric: 'intelligence', value: 80 },
      { source: 'open-bench', entity: 'Beta', metric: 'intelligence', value: 60 },
      { source: 'open-bench', entity: 'Gamma', metric: 'intelligence', value: 40 },
      // future-dated points must NOT leak into today's scoring
      { source: 'open-bench', entity: 'Beta', metric: 'intelligence', value: 999, date: '2999-01-01' },
      { source: 'provider-pricing', entity: 'Alpha', metric: 'price_in', value: 8 },
      { source: 'provider-pricing', entity: 'Alpha', metric: 'price_out', value: 8 },
      { source: 'provider-pricing', entity: 'Beta', metric: 'price_in', value: 2 },
      { source: 'provider-pricing', entity: 'Beta', metric: 'price_out', value: 6 },
      { source: 'radar-speed', entity: 'Alpha', metric: 'output_toks_per_s', value: 100 },
      { source: 'radar-speed', entity: 'Beta', metric: 'output_toks_per_s', value: 50 },
    ]);
    const db = getDb();
    insertMention(db, 'Alpha', 3);
    insertMention(db, 'Alpha', 3);
    insertMention(db, 'Alpha', 10); // prior week
    insertMention(db, 'Beta', 10); // prior week only → delta -1
  }

  it('computes cohort robust-scaled sub-scores and the weighted composite', () => {
    seedFixture();
    const res = computeRadarScores();
    expect(res.scored).toBe(3);

    expect(scoreRows('composite')).toEqual(new Map([['Alpha', 0.5804], ['Beta', 0.492], ['Gamma', 0.3794]]));
    expect(scoreRows('capability')).toEqual(new Map([['Alpha', 0.6608], ['Beta', 0.5], ['Gamma', 0.3392]]));
    expect(scoreRows('cost_efficiency')).toEqual(new Map([['Alpha', 0.3392], ['Beta', 0.6608]]));
    expect(scoreRows('speed')).toEqual(new Map([['Alpha', 0.6608], ['Beta', 0.3392]]));
    expect(scoreRows('momentum')).toEqual(new Map([['Alpha', 0.6608], ['Beta', 0.3392], ['Gamma', 0.5]]));
  });

  it('persists the raw absolute inputs next to the normalized sub-scores', () => {
    seedFixture();
    computeRadarScores();
    // charts plot these: comparable over time, unlike the cohort-relative scores
    expect(scoreRows('capability_raw')).toEqual(new Map([['Alpha', 80], ['Beta', 60], ['Gamma', 40]]));
    expect(scoreRows('cost_efficiency_raw')).toEqual(new Map([['Alpha', 10], ['Beta', 20]]));
    expect(scoreRows('speed_raw')).toEqual(new Map([['Alpha', 100], ['Beta', 50]]));
    expect(scoreRows('momentum_raw')).toEqual(new Map([['Alpha', 1], ['Beta', -1], ['Gamma', 0]]));
  });

  it('an outlier joining the cohort cannot compress everyone else (min-max could)', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'A', metric: 'intelligence', value: 80 },
      { source: 'open-bench', entity: 'B', metric: 'intelligence', value: 60 },
      { source: 'open-bench', entity: 'C', metric: 'intelligence', value: 40 },
    ]);
    computeRadarScores();
    expect(scoreRows('capability').get('B')).toBe(0.5); // cohort median

    // same model, cohort + one outlier: min-max would move B from 0.5 to
    // (60−40)/(500−40) ≈ 0.043 — the stored value of an unchanged model used
    // to swing with whoever else was scored that day
    recordMetrics([{ source: 'open-bench', entity: 'Outlier', metric: 'intelligence', value: 500 }]);
    computeRadarScores();
    const after = scoreRows('capability').get('B')!;
    // cohort [80,60,40,500]: median 70, MAD 20 → z = −0.5 → 0.4174
    expect(after).toBeCloseTo(0.4174, 3);
    expect(after).toBeGreaterThan(0.35); // an order of magnitude above the min-max 0.043
  });

  it('publishes weightsUsed per model — missing inputs renormalize the weights', () => {
    seedFixture();
    const res = computeRadarScores();
    const byEntity = new Map(res.models.map((m) => [m.entity, m]));
    // Gamma has no price and no speed: scored on capability+momentum at .75/.25,
    // NOT the full .45/.15 — the payload must say so
    expect(byEntity.get('Gamma')!.weightsUsed).toEqual({ capability: 0.75, momentum: 0.25 });
    expect(byEntity.get('Gamma')!.missing).toEqual(['costEfficiency', 'speed']);
    expect(byEntity.get('Alpha')!.weightsUsed).toEqual({
      capability: 0.45,
      costEfficiency: 0.25,
      speed: 0.15,
      momentum: 0.15,
    });
    expect(byEntity.get('Alpha')!.missing).toEqual([]);
    expect(res.methodology).toContain('weightsUsed');
  });

  it('a model with no speed or price still scores (weights renormalize)', () => {
    seedFixture();
    computeRadarScores();
    // Gamma: only capability (lo) and momentum (0.5) present →
    // (0.45·0.33924+0.15·0.5)/0.6 = 0.3794, NOT the un-renormalized 0.2277
    expect(scoreRows('composite').get('Gamma')).toBe(0.3794);
    // missing inputs simply have no sub-score rows
    const gammaMetrics = getDb()
      .select({ metric: metricPoints.metric })
      .from(metricPoints)
      .where(and(eq(metricPoints.source, 'radar-score'), eq(metricPoints.entity, 'Gamma')))
      .all()
      .map((r) => r.metric)
      .sort();
    expect(gammaMetrics).toEqual(['capability', 'capability_raw', 'composite', 'momentum', 'momentum_raw']);
  });

  it('single-model cohort scores 0.5 across the board', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'Solo', metric: 'intelligence', value: 60 },
      { source: 'provider-pricing', entity: 'Solo', metric: 'price_in', value: 4 },
    ]);
    expect(computeRadarScores().scored).toBe(1);
    expect(scoreRows('composite').get('Solo')).toBe(0.5);
    expect(scoreRows('capability').get('Solo')).toBe(0.5);
    expect(scoreRows('cost_efficiency').get('Solo')).toBe(0.5);
  });

  it('free SKUs are flagged and excluded from the cost-efficiency cohort instead of crushing it', () => {
    // replaces the old "free-tier prices hit the floor" expectation (Free CE
    // 1000 vs Paid CE 10 → min-max 1/0): the floored free CE sat ~100× above
    // paid models and compressed the whole paid scale toward 0
    recordMetrics([
      { source: 'open-bench', entity: 'Free', metric: 'intelligence', value: 50 },
      { source: 'open-bench', entity: 'Paid1', metric: 'intelligence', value: 50 },
      { source: 'open-bench', entity: 'Paid2', metric: 'intelligence', value: 50 },
      { source: 'provider-pricing', entity: 'Free', metric: 'price_in', value: 0 },
      { source: 'provider-pricing', entity: 'Free', metric: 'price_out', value: 0 },
      { source: 'provider-pricing', entity: 'Paid1', metric: 'price_in', value: 5 },
      { source: 'provider-pricing', entity: 'Paid1', metric: 'price_out', value: 5 },
      { source: 'provider-pricing', entity: 'Paid2', metric: 'price_in', value: 10 },
      { source: 'provider-pricing', entity: 'Paid2', metric: 'price_out', value: 10 },
    ]);
    const res = computeRadarScores();
    const free = res.models.find((m) => m.entity === 'Free')!;
    expect(free.freeSku).toBe(true);
    expect(free.missing).toContain('costEfficiency');
    // the paid cohort keeps its spread (CE 10 vs 5 → hi/lo), not crushed against 1000
    expect(scoreRows('cost_efficiency')).toEqual(new Map([['Paid1', 0.6608], ['Paid2', 0.3392]]));
    expect(res.models.filter((m) => m.freeSku)).toHaveLength(1);
  });

  it('marks single-sided price blends for UI disclosure', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'OutOnly', metric: 'intelligence', value: 50 },
      { source: 'open-bench', entity: 'BothSides', metric: 'intelligence', value: 50 },
      // only the output side is priced — it stands in for the whole 3:1 blend
      // and output runs ~3–4× input, so the derived cost-efficiency is biased
      { source: 'provider-pricing', entity: 'OutOnly', metric: 'price_out', value: 12 },
      { source: 'provider-pricing', entity: 'BothSides', metric: 'price_in', value: 2 },
      { source: 'provider-pricing', entity: 'BothSides', metric: 'price_out', value: 6 },
    ]);
    const res = computeRadarScores();
    const byEntity = new Map(res.models.map((m) => [m.entity, m]));
    expect(byEntity.get('OutOnly')!.singleSided).toBe(true);
    expect(byEntity.get('BothSides')!.singleSided).toBe(false);
    // the single side does feed the blend: CE = 50/12
    expect(scoreRows('cost_efficiency_raw').get('OutOnly')).toBeCloseTo(50 / 12, 3);
  });

  it('momentum uses only complete UTC days — today’s partial mentions are excluded', () => {
    // a run at 06:00 UTC must not bias "recent 7d" downward: mentions landing
    // TODAY are a partial day and wait for tomorrow's close
    recordMetrics([
      { source: 'open-bench', entity: 'Alpha', metric: 'intelligence', value: 80 },
      { source: 'open-bench', entity: 'Beta', metric: 'intelligence', value: 60 },
    ]);
    const db = getDb();
    insertMention(db, 'Alpha', 0); // today (partial) — must NOT count
    insertMention(db, 'Beta', 1); // yesterday (closed) — counts
    computeRadarScores();
    expect(scoreRows('momentum_raw')).toEqual(new Map([['Alpha', 0], ['Beta', 1]]));
    // under the old slice(7) window Alpha's partial-day mention tied Beta 1:1
    expect(scoreRows('momentum').get('Beta')!).toBeGreaterThan(scoreRows('momentum').get('Alpha')!);
  });

  it('bridges the speed series from raw API ids to display names (normalizeModelKey join)', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'GPT-6 Pro', metric: 'intelligence', value: 70 },
      { source: 'open-bench', entity: 'Other Model', metric: 'intelligence', value: 50 },
      // rollupModelSpeed writes raw llm_calls.model ids, which needn't match
      // the open-bench display name — the old direct lookup dropped the input
      { source: 'radar-speed', entity: 'openai/gpt-6-pro', metric: 'output_toks_per_s', value: 88 },
    ]);
    computeRadarScores();
    // sole speed value in the cohort → constant input scales to 0.5, but it MUST be present
    expect(scoreRows('speed').get('GPT-6 Pro')).toBe(0.5);
    expect(scoreRows('speed_raw').get('GPT-6 Pro')).toBe(88);
    expect(scoreRows('speed').has('Other Model')).toBe(false);
  });

  it('latestValues reads the value from each entity’s max-date row (explicit join)', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'Delta', metric: 'intelligence', value: 40, date: '2020-01-01' },
      { source: 'open-bench', entity: 'Delta', metric: 'intelligence', value: 70 }, // today — must win
      { source: 'open-bench', entity: 'Eps', metric: 'intelligence', value: 60 },
    ]);
    computeRadarScores();
    const cap = scoreRows('capability');
    // 70 (latest) puts Delta above Eps; the stale 40 would put it below
    expect(cap.get('Delta')!).toBeGreaterThan(cap.get('Eps')!);
    expect(scoreRows('capability_raw')).toEqual(new Map([['Delta', 70], ['Eps', 60]]));
  });

  it('blends radar-eval into capability when that series exists (dormant §6c path)', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'Alpha', metric: 'intelligence', value: 80 },
      { source: 'open-bench', entity: 'Beta', metric: 'intelligence', value: 60 },
      // Alpha's own eval is weak: blend = 0.5*20 + 0.5*80 = 50 < Beta's 60 → flips the order
      { source: 'radar-eval', entity: 'Alpha', metric: 'score', value: 20 },
    ]);
    computeRadarScores();
    // robust scale replaces min-max here too: cohort [50, 60] → lo/hi (was 0/1)
    expect(scoreRows('capability')).toEqual(new Map([['Alpha', 0.3392], ['Beta', 0.6608]]));
  });

  it('logs signed divergence vs AA after robust-scaling both sides', () => {
    seedFixture();
    // AA prefers Beta over Alpha — opposite of our composite
    seedAaSnapshot([
      { name: 'Alpha', org: null, intelligence: 50, coding: null, price: 8, priceIn: 8, priceOut: 8, speed: null, released: null },
      { name: 'Beta', org: null, intelligence: 90, coding: null, price: 3, priceIn: 2, priceOut: 6, speed: null, released: null },
    ]);
    computeRadarScores();
    // overlap cohort {Alpha, Beta}: both sides sit ±1 MAD apart → hi−lo = ±0.3215
    // (was ±1 under min-max — a two-model cohort always spanned the full range)
    expect(scoreRows('aa_divergence')).toEqual(new Map([['Alpha', 0.3215], ['Beta', -0.3215]]));
  });

  it('writes no divergence rows without an AA snapshot', () => {
    seedFixture();
    computeRadarScores();
    expect(scoreRows('aa_divergence').size).toBe(0);
  });

  it('returns scored 0 when no capability data exists', () => {
    const res = computeRadarScores();
    expect(res.scored).toBe(0);
    expect(res.models).toEqual([]);
  });
});

describe('rollupModelSpeed', () => {
  it('rolls llm_calls into output_toks_per_s over the trailing 7 days', () => {
    const db = getDb();
    const now = Date.now();
    const rows = [
      { model: 'MiniMax-M2', completionTokens: 100, durationMs: 2000, ts: new Date(now - DAY) },
      { model: 'MiniMax-M2', completionTokens: 300, durationMs: 6000, ts: new Date(now - 2 * DAY) },
      // zero-duration call: no speed signal
      { model: 'ZeroDur', completionTokens: 500, durationMs: 0, ts: new Date(now - DAY) },
      // outside the 7-day window
      { model: 'Old-Model', completionTokens: 1000, durationMs: 1000, ts: new Date(now - 10 * DAY) },
    ];
    for (const r of rows) {
      db.insert(llmCalls)
        .values({ feature: 'plan', model: r.model, completionTokens: r.completionTokens, durationMs: r.durationMs, ts: r.ts })
        .run();
    }
    expect(rollupModelSpeed()).toEqual({ models: 1 });
    const rowsOut = getDb()
      .select({ entity: metricPoints.entity, value: metricPoints.value, date: metricPoints.date })
      .from(metricPoints)
      .where(and(eq(metricPoints.source, 'radar-speed'), eq(metricPoints.metric, 'output_toks_per_s')))
      .all();
    expect(rowsOut).toHaveLength(1);
    expect(rowsOut[0]).toMatchObject({ entity: 'MiniMax-M2', value: 50, date: utcDay() }); // 400/8000*1000
  });

  it('the science job runs the rollup and the composite at the END of runScience', async () => {
    const db = getDb();
    db.insert(llmCalls)
      .values({ feature: 'curate', model: 'MiniMax-M2', completionTokens: 200, durationMs: 4000, ts: new Date() })
      .run();
    recordMetrics([
      { source: 'open-bench', entity: 'MiniMax-M2', metric: 'intelligence', value: 51 },
      { source: 'open-bench', entity: 'Other', metric: 'intelligence', value: 40 },
    ]);
    const stats = await runScience();
    expect(stats.speedModels).toBe(1);
    expect(stats.radarScored).toBe(2);
    // MiniMax-M2 picked up its fresh speed series the same night; Other has none.
    // (sole speed value in the cohort → constant input scales to 0.5)
    expect(scoreRows('speed').get('MiniMax-M2')).toBe(0.5);
    expect(scoreRows('speed').has('Other')).toBe(false);
  });
});
