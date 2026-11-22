import { beforeEach, describe, expect, it } from 'vitest';
import { benchmarkSnapshots } from '@/lib/db/schema';
import { getDb } from '@/lib/db';
import { recordMetrics, utcDay } from '@/lib/metrics';
import {
  benchPromptLines,
  computeAllComposites,
  computeBenchComposite,
  latestBenchComposite,
  runBenchComposites,
  STABILITY_FLAG,
} from '@/lib/science/composite-bench';
import { useTestDb } from './helpers/db';

const CODING = ['swe_bench_verified', 'terminal_bench', 'webdev_arena', 'cursor_bench', 'deepswe', 'frontier_swe'];

/** Seeds one benchmark: model i gets value base + i * step (higher index = better). */
function seedBench(metric: string, models: string[], value: (i: number) => number, date?: string): void {
  recordMetrics(models.map((m, i) => ({ source: 'epoch-bench', entity: m, metric, value: value(i), date })));
}

const names = (n: number) => Array.from({ length: n }, (_, i) => `Model ${i}`);

beforeEach(() => {
  useTestDb();
});

describe('computeBenchComposite', () => {
  it('ranks models by their average standing across benchmarks, each on its own scale', () => {
    // three benchmarks on wildly different scales, same underlying order
    seedBench('swe_bench_verified', names(10), (i) => 0.3 + i * 0.05); // fraction
    seedBench('webdev_arena', names(10), (i) => 1100 + i * 40); // Elo
    seedBench('deepswe', names(10), (i) => 20 + i * 3); // percent
    const res = computeBenchComposite('coding');
    expect(res.sources.map((s) => s.label)).toEqual(['SWE-bench Verified', 'Arena WebDev (Elo)', 'DeepSWE']);
    expect(res.models.map((m) => m.entity)).toEqual(names(10).reverse());
    expect(res.models.every((m) => m.n === 3)).toBe(true);
    expect(res.models[0]!.score).toBeGreaterThan(res.models[9]!.score);
    // 0-100 scale, centre-anchored
    expect(res.models.every((m) => m.score > 0 && m.score < 100)).toBe(true);
  });

  it('gives no score to a model measured on fewer than 3 benchmarks', () => {
    for (const id of CODING.slice(0, 3)) seedBench(id, names(10), (i) => i);
    // "Late" shows up in only two benchmarks
    recordMetrics([
      { source: 'epoch-bench', entity: 'Late', metric: CODING[0]!, value: 99 },
      { source: 'epoch-bench', entity: 'Late', metric: CODING[1]!, value: 99 },
    ]);
    const res = computeBenchComposite('coding');
    expect(res.models.some((m) => m.entity === 'Late')).toBe(false);
    expect(res.models).toHaveLength(10);
  });

  it('shrinks thin coverage: top of 3 benchmarks ranks below top of 6 with the same standing', () => {
    const cohort = names(10);
    // "Wide" tops all six benchmarks; "Thin" tops only the first three
    for (const [k, id] of CODING.entries()) {
      seedBench(id, cohort, (i) => i);
      recordMetrics([
        { source: 'epoch-bench', entity: 'Wide', metric: id, value: 100 },
        ...(k < 3 ? [{ source: 'epoch-bench', entity: 'Thin', metric: id, value: 100 }] : []),
      ]);
    }
    const res = computeBenchComposite('coding');
    const by = Object.fromEntries(res.models.map((m) => [m.entity, m]));
    expect(by['Wide']!.n).toBe(6);
    expect(by['Thin']!.n).toBe(3);
    expect(by['Wide']!.score).toBeGreaterThan(by['Thin']!.score);
  });

  it('flags a score that hinges on one benchmark (leave-one-out swing)', () => {
    const cohort = names(12);
    for (const id of CODING.slice(0, 4)) seedBench(id, cohort, (i) => i);
    recordMetrics([
      // "Spiky": absurdly high in one benchmark, bottom of the pack in the other three
      { source: 'epoch-bench', entity: 'Spiky', metric: CODING[0]!, value: 1000 },
      { source: 'epoch-bench', entity: 'Spiky', metric: CODING[1]!, value: -50 },
      { source: 'epoch-bench', entity: 'Spiky', metric: CODING[2]!, value: -50 },
      { source: 'epoch-bench', entity: 'Spiky', metric: CODING[3]!, value: -50 },
      // "Steady": middle of the pack everywhere
      ...CODING.slice(0, 4).map((id) => ({ source: 'epoch-bench', entity: 'Steady', metric: id, value: 5.5 })),
    ]);
    const by = Object.fromEntries(computeBenchComposite('coding').models.map((m) => [m.entity, m]));
    expect(by['Spiky']!.stability! / 100).toBeGreaterThan(STABILITY_FLAG);
    expect(by['Spiky']!.unstable).toBe(true);
    expect(by['Steady']!.unstable).toBe(false);
  });

  it('drops a benchmark whose cohort is too small, and one that stopped updating', () => {
    seedBench('swe_bench_verified', names(10), (i) => i);
    seedBench('terminal_bench', names(10), (i) => i);
    seedBench('webdev_arena', names(10), (i) => i);
    seedBench('deepswe', names(5), (i) => i); // too few models
    const old = utcDay(new Date(Date.now() - 60 * 864e5));
    seedBench('cursor_bench', names(10), (i) => i, old); // stale series
    const res = computeBenchComposite('coding');
    expect(res.sources).toHaveLength(3);
    // every configured-but-unusable benchmark is reported with the models it had (never silent)
    const dropped = Object.fromEntries(res.dropped.map((d) => [d.label, d.models]));
    expect(dropped['DeepSWE']).toBe(5);
    expect(dropped['CursorBench']).toBe(0); // 60-day-old values no longer count
  });

  it('joins models across sources by normalized key and shows the AA base name when AA lists the model', () => {
    seedBench('swe_bench_verified', [...names(8), 'claude-opus-5-5'], (i) => i);
    recordMetrics(
      ['terminal_bench', 'webdev_arena'].flatMap((metric) =>
        [...names(8), 'Claude Opus 5.5 (Max)'].map((entity, i) => ({ source: 'epoch-bench', entity, metric, value: i })),
      ),
    );
    getDb()
      .insert(benchmarkSnapshots)
      .values({
        source: 'artificial-analysis',
        raw: JSON.stringify({
          compact: true,
          models: [{ name: 'Claude Opus 5.5 (Max, Default Fallback)', org: null, intelligence: 59, coding: null, price: 8, priceIn: 5, priceOut: 25, speed: null, released: null }],
        }),
        fetchedAt: new Date(),
      })
      .run();
    const res = computeBenchComposite('coding');
    const opus = res.models.find((m) => m.entity === 'Claude Opus 5.5');
    expect(opus).toBeDefined();
    expect(opus!.n).toBe(3); // one model, three differently-spelled sources
    expect(res.models.filter((m) => /opus/i.test(m.entity))).toHaveLength(1);
  });

  it('turns a raw slug into words when no source has a readable name', () => {
    for (const id of CODING.slice(0, 3)) seedBench(id, [...names(8), 'gpt-6-astra'], (i) => i);
    const res = computeBenchComposite('coding');
    expect(res.models.some((m) => m.entity === 'GPT 6 Astra')).toBe(true);
  });
});

describe('stored composites', () => {
  beforeEach(() => {
    for (const id of CODING.slice(0, 4)) seedBench(id, names(10), (i) => i);
  });

  it('stores score / n / stability under source radar-bench and reads them back best-first', () => {
    const counts = computeAllComposites();
    expect(counts.coding).toBe(10);
    expect(counts.agentic).toBe(0); // no agentic inputs seeded: nothing invented
    const { date, models } = latestBenchComposite('coding');
    expect(date).toBe(utcDay());
    expect(models).toHaveLength(10);
    expect(models[0]!.entity).toBe('Model 9');
    expect(models[0]!.n).toBe(4);
    expect(models[0]!.score).toBeGreaterThan(models[9]!.score);
  });

  it('formats prompt lines with the evidence depth', () => {
    computeAllComposites();
    const lines = benchPromptLines('coding', 3)!.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^- Model 9: [\d.]+ \(4 benchmarks\)$/);
    expect(benchPromptLines('agentic')).toBeNull();
  });

  it('the scheduled job FAILS when a capability scores nobody', () => {
    expect(() => runBenchComposites()).toThrow(/agentic/);
  });
});
