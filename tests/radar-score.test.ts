import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { useTestDb } from './helpers/db';
import { getDb, type Db } from '@/lib/db';
import { benchmarkSnapshots, llmCalls, metricPoints, stories } from '@/lib/db/schema';
import { recordMetrics, utcDay } from '@/lib/metrics';
import { computeRadarScores, normalizeCohort, rollupModelSpeed } from '@/lib/science/score';

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

describe('normalizeCohort', () => {
  it('min-max normalizes to 0..1', () => {
    expect(normalizeCohort([10, 20, 30])).toEqual([0, 0.5, 1]);
    expect(normalizeCohort([-1, 1])).toEqual([0, 1]);
  });

  it('maps a constant input to 0.5 (no information → neutral)', () => {
    expect(normalizeCohort([7, 7, 7])).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('computeRadarScores (§6e)', () => {
  /**
   * Hand-computed fixture:
   *   capability  Alpha 80, Beta 60, Gamma 40          → norm 1, 0.5, 0
   *   price blend Alpha 8 ($8/$8), Beta 3 ($2/$6)      → costEff 10, 20 → norm 0, 1; Gamma missing
   *   speed       Alpha 100, Beta 50                    → norm 1, 0; Gamma missing
   *   momentum    Alpha +1, Beta -1, Gamma 0            → norm 1, 0, 0.5
   * composites: Alpha .45*1+.25*0+.15*1+.15*1 = 0.75
   *             Beta  .45*.5+.25*1+.15*0+.15*0 = 0.475
   *             Gamma (.45*0+.15*.5)/(.45+.15) = 0.125 (missing inputs renormalize)
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

  it('computes cohort-normalized sub-scores and the weighted composite', () => {
    seedFixture();
    const res = computeRadarScores();
    expect(res.scored).toBe(3);

    expect(scoreRows('composite')).toEqual(new Map([['Alpha', 0.75], ['Beta', 0.475], ['Gamma', 0.125]]));
    expect(scoreRows('capability')).toEqual(new Map([['Alpha', 1], ['Beta', 0.5], ['Gamma', 0]]));
    expect(scoreRows('cost_efficiency')).toEqual(new Map([['Alpha', 0], ['Beta', 1]]));
    expect(scoreRows('speed')).toEqual(new Map([['Alpha', 1], ['Beta', 0]]));
    expect(scoreRows('momentum')).toEqual(new Map([['Alpha', 1], ['Beta', 0], ['Gamma', 0.5]]));
  });

  it('a model with no speed or price still scores (weights renormalize)', () => {
    seedFixture();
    computeRadarScores();
    // Gamma: only capability (0) and momentum (0.5) present → (0.45*0+0.15*0.5)/0.6 = 0.125,
    // NOT the un-renormalized 0.075
    expect(scoreRows('composite').get('Gamma')).toBe(0.125);
    // missing inputs simply have no sub-score rows
    const gammaMetrics = getDb()
      .select({ metric: metricPoints.metric })
      .from(metricPoints)
      .where(and(eq(metricPoints.source, 'radar-score'), eq(metricPoints.entity, 'Gamma')))
      .all()
      .map((r) => r.metric)
      .sort();
    expect(gammaMetrics).toEqual(['capability', 'composite', 'momentum']);
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

  it('free-tier prices hit the floor instead of dividing by zero', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'Free', metric: 'intelligence', value: 50 },
      { source: 'open-bench', entity: 'Paid', metric: 'intelligence', value: 50 },
      { source: 'provider-pricing', entity: 'Free', metric: 'price_in', value: 0 },
      { source: 'provider-pricing', entity: 'Free', metric: 'price_out', value: 0 },
      { source: 'provider-pricing', entity: 'Paid', metric: 'price_in', value: 5 },
      { source: 'provider-pricing', entity: 'Paid', metric: 'price_out', value: 5 },
    ]);
    const res = computeRadarScores();
    expect(res.scored).toBe(2);
    // Free: 50/max(0, 0.05) = 1000; Paid: 50/5 = 10 → Free normalizes to 1, Paid to 0
    expect(scoreRows('cost_efficiency')).toEqual(new Map([['Free', 1], ['Paid', 0]]));
  });

  it('blends radar-eval into capability when that series exists (dormant §6c path)', () => {
    recordMetrics([
      { source: 'open-bench', entity: 'Alpha', metric: 'intelligence', value: 80 },
      { source: 'open-bench', entity: 'Beta', metric: 'intelligence', value: 60 },
      // Alpha's own eval is weak: blend = 0.5*20 + 0.5*80 = 50 < Beta's 60 → flips the order
      { source: 'radar-eval', entity: 'Alpha', metric: 'score', value: 20 },
    ]);
    computeRadarScores();
    expect(scoreRows('capability')).toEqual(new Map([['Alpha', 0], ['Beta', 1]]));
  });

  it('logs signed divergence vs AA after cohort-normalizing both sides', () => {
    seedFixture();
    // AA prefers Beta over Alpha — opposite of our composite
    seedAaSnapshot([
      { name: 'Alpha', org: null, intelligence: 50, coding: null, price: 8, priceIn: 8, priceOut: 8, speed: null, released: null },
      { name: 'Beta', org: null, intelligence: 90, coding: null, price: 3, priceIn: 2, priceOut: 6, speed: null, released: null },
    ]);
    computeRadarScores();
    // overlap cohort {Alpha, Beta}: normComposite 1/0, normAa 0/1 → +1 / -1
    expect(scoreRows('aa_divergence')).toEqual(new Map([['Alpha', 1], ['Beta', -1]]));
  });

  it('writes no divergence rows without an AA snapshot', () => {
    seedFixture();
    computeRadarScores();
    expect(scoreRows('aa_divergence').size).toBe(0);
  });

  it('returns scored 0 when no capability data exists', () => {
    expect(computeRadarScores().scored).toBe(0);
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
    // (sole speed value in the cohort → constant input normalizes to 0.5)
    expect(scoreRows('speed').get('MiniMax-M2')).toBe(0.5);
    expect(scoreRows('speed').has('Other')).toBe(false);
  });
});
