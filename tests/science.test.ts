import { describe, it, expect, vi } from 'vitest';
import { useTestDb } from './helpers/db';
import { metricPoints, painPoints, stories, topicClusters } from '@/lib/db/schema';
import { upsertMetric, utcDay } from '@/lib/metrics';
import { vecToBuffer } from '@/lib/vec';
import {
  crossCorrelate,
  kmeans,
  linearFit,
  makeRng,
  meanStd,
  pca2d,
  zScore,
} from '@/lib/science/math';
import { projectSeries } from '@/lib/science/forecast';
import { sanitizeClusterLabels, runClustering } from '@/lib/science/cluster';
import {
  detectEntitySurges,
  detectPainClusters,
  detectPriceDrops,
  detectSectorSpikes,
  sanitizeNarrations,
} from '@/lib/science/anomaly';
import { lagReadiness } from '@/lib/science/lag';

vi.mock('@/lib/llm/minimax', () => ({
  chatJSON: vi.fn(),
  LlmError: class LlmError extends Error {},
}));
// eslint-disable-next-line import/first
import { chatJSON } from '@/lib/llm/minimax';

function blobVec(cx: number, dim = 16, jitter = 0.05, rng = makeRng(42)): Float32Array {
  const v = new Float32Array(dim);
  v[0] = cx + (rng() - 0.5) * jitter;
  v[1] = 1 - cx + (rng() - 0.5) * jitter;
  return v;
}

describe('science math', () => {
  it('kmeans separates two blobs deterministically', () => {
    const rng = makeRng(7);
    const vectors = [
      ...Array.from({ length: 10 }, () => blobVec(0, 16, 0.05, rng)),
      ...Array.from({ length: 10 }, () => blobVec(1, 16, 0.05, rng)),
    ];
    const a = kmeans(vectors, 2);
    const b = kmeans(vectors, 2);
    expect(a.assignments).toEqual(b.assignments); // seeded → deterministic
    const first = new Set(a.assignments.slice(0, 10));
    const second = new Set(a.assignments.slice(10));
    expect(first.size).toBe(1);
    expect(second.size).toBe(1);
    expect([...first][0]).not.toBe([...second][0]);
  });

  it('pca2d separates blobs along a component and normalizes spread', () => {
    const rng = makeRng(9);
    const vectors = [
      ...Array.from({ length: 12 }, () => blobVec(0, 16, 0.02, rng)),
      ...Array.from({ length: 12 }, () => blobVec(1, 16, 0.02, rng)),
    ];
    const coords = pca2d(vectors);
    expect(coords).toHaveLength(24);
    expect(Math.max(...coords.map((c) => Math.max(Math.abs(c.x), Math.abs(c.y))))).toBeLessThanOrEqual(1.001);
    const g1 = coords.slice(0, 12).reduce((a, c) => a + c.x, 0) / 12;
    const g2 = coords.slice(12).reduce((a, c) => a + c.x, 0) / 12;
    expect(Math.abs(g1 - g2)).toBeGreaterThan(0.5); // clearly separated on PC1
  });

  it('meanStd and zScore behave on known data', () => {
    expect(meanStd([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({ mean: 5, std: 2 });
    expect(zScore(9, [2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 5);
    expect(zScore(5, [5, 5, 5])).toBe(0); // degenerate baseline, not above mean
  });

  it('linearFit recovers y = 2x + 1 exactly', () => {
    const fit = linearFit([0, 1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 1 })))!;
    expect(fit.slope).toBeCloseTo(2, 8);
    expect(fit.intercept).toBeCloseTo(1, 8);
    expect(fit.r2).toBeCloseTo(1, 8);
  });

  it('crossCorrelate finds a planted 3-day lag', () => {
    const rng = makeRng(3);
    const a = Array.from({ length: 40 }, () => (rng() > 0.7 ? 5 : 1));
    const b = [0, 0, 0, ...a.slice(0, 37)]; // b follows a by 3
    const best = crossCorrelate(a, b, 6)!;
    expect(best.lag).toBe(3);
    expect(best.coefficient).toBeGreaterThan(0.9);
  });
});

describe('forecast projection', () => {
  const day = (i: number) => new Date(Date.parse('2026-07-01') + i * 864e5).toISOString().slice(0, 10);

  it('stays in warming-up state below 5 days of history', () => {
    const f = projectSeries([0, 1, 2].map((i) => ({ date: day(i), value: 10 - i })), 30);
    expect(f.projection).toEqual([]);
    expect(f.daysOfHistory).toBe(3);
  });

  it('projects a decreasing log-linear trend with ordered bands', () => {
    // price halves every 5 days
    const history = Array.from({ length: 10 }, (_, i) => ({ date: day(i), value: 10 * 2 ** (-i / 5) }));
    const f = projectSeries(history, 30);
    expect(f.projection.length).toBeGreaterThan(5);
    const last = f.projection[f.projection.length - 1];
    expect(last.mid).toBeLessThan(history[history.length - 1].value);
    expect(last.lo).toBeLessThan(last.mid);
    expect(last.hi).toBeGreaterThan(last.mid);
    expect(f.fit!.r2).toBeGreaterThan(0.99);
  });
});

describe('cluster labeling', () => {
  it('sanitizeClusterLabels enforces bounds and shapes', () => {
    const out = sanitizeClusterLabels(
      { '0': { label: 'Video LoRA workflows', summary: 'ok' }, '9': { label: 'out of range' }, '1': { label: '' } },
      3,
    );
    expect(out.size).toBe(1);
    expect(out.get(0)!.label).toBe('Video LoRA workflows');
  });

  it('runClustering clusters embedded stories and writes the map', async () => {
    const db = useTestDb();
    const rng = makeRng(11);
    for (let i = 0; i < 24; i++) {
      db.insert(stories)
        .values({
          title: i < 12 ? `video story ${i}` : `coding story ${i}`,
          status: 'curated',
          topScore: 60,
          embedding: vecToBuffer(blobVec(i < 12 ? 0 : 1, 16, 0.02, rng)),
          createdAt: new Date(),
        })
        .run();
    }
    vi.mocked(chatJSON).mockResolvedValueOnce({
      clusters: { '0': { label: 'Alpha', summary: 's' }, '1': { label: 'Beta', summary: 's' } },
    } as never);
    const res = await runClustering();
    expect(res.mapped).toBe(24);
    expect(res.clusters).toBeGreaterThanOrEqual(2);
    const clusters = db.select().from(topicClusters).all();
    expect(clusters.length).toBe(res.clusters);
    expect(Math.max(...clusters.map((c) => c.heat))).toBeCloseTo(1, 5);
    const mapped = db.select().from(stories).all().filter((s) => s.mapX !== null && s.clusterId !== null);
    expect(mapped).toHaveLength(24);
  });
});

describe('anomaly detectors', () => {
  it('detectSectorSpikes fires on a genuine spike with enough history', () => {
    const db = useTestDb();
    const insert = (daysAgo: number, n: number) => {
      for (let i = 0; i < n; i++) {
        db.insert(stories)
          .values({
            title: `s${daysAgo}-${i}`,
            status: 'curated',
            topScore: 50,
            domainScores: JSON.stringify({ coding: 80, copy: 0, image: 0, video: 0, ads: 0, agentic: 0 }),
            createdAt: new Date(Date.now() - daysAgo * 864e5),
          })
          .run();
      }
    };
    for (let d = 1; d <= 8; d++) insert(d, 1); // steady baseline
    insert(0, 8); // today's spike
    const hits = detectSectorSpikes();
    expect(hits.some((h) => h.subject === 'coding' && h.score >= 2)).toBe(true);
  });

  it('detectEntitySurges fires on new and surging entities', () => {
    const db = useTestDb();
    const add = (name: string, daysAgo: number) =>
      db.insert(stories)
        .values({
          title: `${name} ${daysAgo} ${Math.random()}`,
          status: 'curated',
          topScore: 50,
          entities: JSON.stringify([{ name, kind: 'model' }]),
          createdAt: new Date(Date.now() - daysAgo * 864e5),
        })
        .run();
    for (let i = 0; i < 6; i++) add('NovaModel', i % 5); // 6 mentions this week, 0 last week
    const hits = detectEntitySurges();
    expect(hits.some((h) => h.subject === 'NovaModel')).toBe(true);
  });

  it('detectPriceDrops needs two snapshot days and a ≥15% drop', () => {
    useTestDb();
    const yesterday = utcDay(new Date(Date.now() - 864e5));
    upsertMetric({ source: 'aa', entity: 'M', metric: 'price_blended', value: 10, date: yesterday });
    upsertMetric({ source: 'aa', entity: 'M', metric: 'price_blended', value: 8 });
    upsertMetric({ source: 'aa', entity: 'Stable', metric: 'price_blended', value: 10, date: yesterday });
    upsertMetric({ source: 'aa', entity: 'Stable', metric: 'price_blended', value: 9.5 });
    const hits = detectPriceDrops();
    expect(hits).toHaveLength(1);
    expect(hits[0].subject).toBe('M');
  });

  it('detectPainClusters surfaces recurring pains only', () => {
    const db = useTestDb();
    db.insert(painPoints)
      .values([
        { summary: 'recurring pain here', intensity: 4, evidence: '[]', lastSeenAt: new Date(), createdAt: new Date() },
        { summary: 'one-off pain', intensity: 1, evidence: '[]', lastSeenAt: new Date(), createdAt: new Date() },
      ])
      .run();
    const hits = detectPainClusters();
    expect(hits).toHaveLength(1);
    expect(hits[0].subject).toContain('recurring');
  });

  it('sanitizeNarrations bounds indexes and trims', () => {
    const out = sanitizeNarrations({ '0': { headline: 'H', detail: 'D' }, '5': { headline: 'x', detail: 'y' } }, 2);
    expect(out.size).toBe(1);
  });
});

describe('lag machinery', () => {
  it('readiness counts distinct launch-count days', () => {
    useTestDb();
    expect(lagReadiness()).toMatchObject({ days: 0, ready: false });
    upsertMetric({ source: 'launches', entity: 'agents', metric: 'count', value: 3 });
    upsertMetric({ source: 'launches', entity: 'devtools', metric: 'count', value: 2 });
    expect(lagReadiness().days).toBe(1);
  });
});
