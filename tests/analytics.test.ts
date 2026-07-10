import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { benchmarkSnapshots, items, sources, stories } from '@/lib/db/schema';
import {
  aaModels,
  dailyDomainCounts,
  domainMomentum,
  echoStats,
  paretoFrontier,
  topEntities,
} from '@/lib/analytics';
import { compactAaMediaSnapshot, compactAaSnapshot } from '@/lib/board/sync';
import { fmtUsd, taskCost, TASK_ARCHETYPES } from '@/lib/costs';
import { aaMedia, llmUsageHistory, pipelineFunnel, sourceVolume } from '@/lib/analytics';
import { llmUsage } from '@/lib/db/schema';
import { sanitizeEntities } from '@/lib/curate/curate';
import { sanitizeInsights } from '@/lib/brief/brief';

const DAY = 864e5;

function insertStory(
  db: Db,
  opts: {
    title?: string;
    daysAgo: number;
    coding?: number;
    image?: number;
    entities?: { name: string; kind: string }[];
  },
) {
  return db
    .insert(stories)
    .values({
      title: opts.title ?? `story ${Math.random()}`,
      status: 'curated',
      topScore: Math.max(opts.coding ?? 0, opts.image ?? 0),
      domainScores: JSON.stringify({
        coding: opts.coding ?? 0,
        copy: 0,
        image: opts.image ?? 0,
        video: 0,
        ads: 0,
        agentic: 0,
      }),
      entities: opts.entities ? JSON.stringify(opts.entities) : null,
      createdAt: new Date(Date.now() - opts.daysAgo * DAY),
    })
    .returning()
    .get();
}

describe('analytics', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('dailyDomainCounts zero-fills days and buckets by domain membership', () => {
    insertStory(db, { daysAgo: 0, coding: 80 });
    insertStory(db, { daysAgo: 0, coding: 50, image: 45 });
    insertStory(db, { daysAgo: 2, image: 90 });
    insertStory(db, { daysAgo: 2, coding: 20 }); // below threshold — total only
    const days = dailyDomainCounts(7);
    expect(days).toHaveLength(7);
    const today = days[6];
    const twoBack = days[4];
    expect(today.total).toBe(2);
    expect(today.byDomain.coding).toBe(2);
    expect(today.byDomain.image).toBe(1);
    expect(twoBack.total).toBe(2);
    expect(twoBack.byDomain.image).toBe(1);
    expect(twoBack.byDomain.coding).toBe(0);
    expect(days[0].total).toBe(0); // zero-filled
  });

  it('domainMomentum compares this week to last week', () => {
    insertStory(db, { daysAgo: 1, coding: 80 });
    insertStory(db, { daysAgo: 2, coding: 80 });
    insertStory(db, { daysAgo: 9, coding: 80 });
    insertStory(db, { daysAgo: 10, image: 80 });
    const momentum = Object.fromEntries(domainMomentum().map((m) => [m.domain, m]));
    expect(momentum.coding.thisWeek).toBe(2);
    expect(momentum.coding.lastWeek).toBe(1);
    expect(momentum.coding.deltaPct).toBe(100);
    expect(momentum.image.thisWeek).toBe(0);
    expect(momentum.image.deltaPct).toBe(-100);
    expect(momentum.video.deltaPct).toBeNull(); // nothing either week
  });

  it('topEntities counts once per story, tracks prior-week counts, sorts by count', () => {
    const qwen = [{ name: 'Qwen4', kind: 'model' }];
    insertStory(db, { daysAgo: 1, coding: 80, entities: [...qwen, { name: 'qwen4', kind: 'model' }] });
    insertStory(db, { daysAgo: 2, coding: 80, entities: qwen });
    insertStory(db, { daysAgo: 3, coding: 80, entities: [{ name: 'Claude Code', kind: 'tool' }] });
    insertStory(db, { daysAgo: 9, coding: 80, entities: qwen });
    const top = topEntities(5);
    expect(top[0]).toMatchObject({ name: 'Qwen4', count: 2, prev: 1 });
    expect(top[1]).toMatchObject({ name: 'Claude Code', count: 1, prev: 0 });
  });

  it('echoStats counts multi-source stories and finds the strongest echo', () => {
    const src = db
      .insert(sources)
      .values({ type: 'rss', name: 'test', config: '{}' })
      .returning()
      .get();
    const single = insertStory(db, { title: 'single-source', daysAgo: 1, coding: 80 });
    const multi = insertStory(db, { title: 'multi-source story', daysAgo: 1, coding: 80 });
    const now = new Date();
    db.insert(items).values([
      { sourceId: src.id, url: 'https://a.example/1', title: 'a', fetchedAt: now, storyId: single.id },
      { sourceId: src.id, url: 'https://a.example/2', title: 'b', fetchedAt: now, storyId: multi.id },
      { sourceId: src.id, url: 'https://a.example/3', title: 'c', fetchedAt: now, storyId: multi.id },
      { sourceId: src.id, url: 'https://a.example/4', title: 'd', fetchedAt: now, storyId: multi.id },
    ]).run();
    const echoes = echoStats();
    expect(echoes.multiSource).toBe(1);
    expect(echoes.strongest).toEqual({ title: 'multi-source story', sources: 3 });
  });
});

describe('artificial analysis data', () => {
  const AA_RAW = JSON.stringify({
    status: 200,
    data: [
      {
        name: 'GPT-5.5',
        release_date: '2026-04-23',
        model_creator: { name: 'OpenAI' },
        evaluations: { artificial_analysis_intelligence_index: 35.4, artificial_analysis_coding_index: 56.5 },
        pricing: { price_1m_blended_3_to_1: 11.25, price_1m_input_tokens: 5, price_1m_output_tokens: 30 },
        median_output_tokens_per_second: 59.3,
      },
      {
        name: 'MiniMax M2',
        release_date: '2025-12-01',
        model_creator: { name: 'MiniMax' },
        evaluations: { artificial_analysis_intelligence_index: 30.1, artificial_analysis_coding_index: null },
        pricing: { price_1m_blended_3_to_1: 0.53 },
        median_output_tokens_per_second: 92.1,
      },
      { name: 'no-metrics-model', evaluations: {}, pricing: {} },
      { evaluations: { artificial_analysis_intelligence_index: 50 } }, // nameless → dropped
    ],
  });

  it('compactAaSnapshot keeps only needed fields and drops nameless rows', () => {
    const compact = JSON.parse(compactAaSnapshot(AA_RAW)) as { compact: boolean; models: unknown[] };
    expect(compact.compact).toBe(true);
    expect(compact.models).toHaveLength(3);
    expect(compact.models[0]).toMatchObject({ name: 'GPT-5.5', org: 'OpenAI', intelligence: 35.4, price: 11.25 });
  });

  it('compactAaSnapshot falls back to a slice on unparseable input', () => {
    expect(compactAaSnapshot('not json at all')).toBe('not json at all');
  });

  it('aaModels reads the latest compact snapshot, filters unpriced models, sorts by intelligence', () => {
    const db = useTestDb();
    db.insert(benchmarkSnapshots)
      .values({ source: 'artificial-analysis', raw: compactAaSnapshot(AA_RAW), fetchedAt: new Date() })
      .run();
    const res = aaModels();
    expect(res).not.toBeNull();
    expect(res!.models).toHaveLength(2); // no-metrics-model dropped
    expect(res!.models[0].name).toBe('GPT-5.5');
    expect(res!.models[1]).toMatchObject({ name: 'MiniMax M2', coding: null, speed: 92.1 });
  });

  it('aaModels returns null without a snapshot', () => {
    useTestDb();
    expect(aaModels()).toBeNull();
  });

  it('paretoFrontier marks cheaper-and-better points only', () => {
    // (price, quality): B dominates C (cheaper AND better); A is priciest but best; D cheapest.
    const pts = [
      { x: 10, y: 90 }, // A frontier (best quality)
      { x: 1, y: 70 },  // B frontier
      { x: 2, y: 60 },  // C dominated by B
      { x: 0.1, y: 20 } // D frontier (cheapest)
    ];
    expect(paretoFrontier(pts)).toEqual([true, true, false, true]);
  });
});

describe('task costs', () => {
  it('taskCost = in*priceIn + out*priceOut per million', () => {
    const landing = TASK_ARCHETYPES.find((t) => t.key === 'landing')!;
    // 6k in @ $5/1M + 12k out @ $30/1M = $0.03 + $0.36 = $0.39
    expect(taskCost({ priceIn: 5, priceOut: 30 }, landing)).toBeCloseTo(0.39, 5);
    expect(taskCost({ priceIn: null, priceOut: 30 }, landing)).toBeNull();
  });

  it('agent sessions are input-heavy: cheap-output models can still be pricey', () => {
    const agent = TASK_ARCHETYPES.find((t) => t.key === 'agent')!;
    const inputHeavy = taskCost({ priceIn: 5, priceOut: 1 }, agent)!;
    const outputHeavy = taskCost({ priceIn: 1, priceOut: 5 }, agent)!;
    expect(inputHeavy).toBeGreaterThan(outputHeavy); // 150k in dominates
  });

  it('fmtUsd scales precision with magnitude', () => {
    expect(fmtUsd(12.3)).toBe('$12.3');
    expect(fmtUsd(1.234)).toBe('$1.23');
    expect(fmtUsd(0.1234)).toBe('$0.123');
    expect(fmtUsd(0.01234)).toBe('$0.0123');
  });
});

describe('media arenas', () => {
  const MEDIA_RAW = JSON.stringify({
    status: 200,
    data: [
      { name: 'HappyHorse-1.0', model_creator: { name: 'Alibaba-ATH' }, elo: 1286, rank: 1, release_date: '2026-04' },
      { name: 'Seedance 2.0', model_creator: { name: 'ByteDance Seed' }, elo: 1272, rank: 3, release_date: '2026-03' },
      { name: 'broken', elo: null, rank: 2 },
    ],
  });

  it('compactAaMediaSnapshot keeps ranked entries only', () => {
    const compact = JSON.parse(compactAaMediaSnapshot(MEDIA_RAW)) as { models: unknown[] };
    expect(compact.models).toHaveLength(2);
    expect(compact.models[0]).toMatchObject({ name: 'HappyHorse-1.0', elo: 1286, rank: 1 });
  });

  it('aaMedia reads per-type snapshots', () => {
    const db = useTestDb();
    db.insert(benchmarkSnapshots)
      .values({ source: 'aa-media-video', raw: compactAaMediaSnapshot(MEDIA_RAW), fetchedAt: new Date() })
      .run();
    const media = aaMedia();
    expect(media).not.toBeNull();
    expect(media!.arenas.video).toHaveLength(2);
    expect(media!.arenas.image).toBeUndefined();
    expect(media!.arenas.video![0].name).toBe('HappyHorse-1.0');
  });
});

describe('ops analytics', () => {
  it('pipelineFunnel counts items, stories, curated and top signals in-window', () => {
    const db = useTestDb();
    const src = db.insert(sources).values({ type: 'rss', name: 's', config: '{}' }).returning().get();
    const now = new Date();
    db.insert(items).values([
      { sourceId: src.id, url: 'https://x.example/1', title: 'a', fetchedAt: now },
      { sourceId: src.id, url: 'https://x.example/2', title: 'b', fetchedAt: now },
      { sourceId: src.id, url: 'https://x.example/3', title: 'c', fetchedAt: new Date(now.getTime() - 10 * 864e5) }, // out of window
    ]).run();
    insertStory(db, { daysAgo: 1, coding: 85 }); // curated, top signal
    insertStory(db, { daysAgo: 1, coding: 50 }); // curated
    db.insert(stories)
      .values({ title: 'raw one', status: 'raw', topScore: 0, createdAt: now })
      .run();
    expect(pipelineFunnel()).toEqual({ items: 2, stories: 3, curated: 2, topSignals: 1 });
  });

  it('llmUsageHistory zero-fills days and reports the cap', () => {
    const db = useTestDb();
    const today = new Date().toISOString().slice(0, 10);
    db.insert(llmUsage).values({ date: today, calls: 42 }).run();
    const usage = llmUsageHistory(5);
    expect(usage.days).toHaveLength(5);
    expect(usage.days[4]).toEqual({ date: today, calls: 42 });
    expect(usage.days[0].calls).toBe(0);
    expect(usage.cap).toBeGreaterThan(0);
  });

  it('sourceVolume buckets items per source per day', () => {
    const db = useTestDb();
    const a = db.insert(sources).values({ type: 'rss', name: 'Feed A', config: '{}' }).returning().get();
    const b = db.insert(sources).values({ type: 'rss', name: 'Feed B', config: '{}' }).returning().get();
    const now = new Date();
    db.insert(items).values([
      { sourceId: a.id, url: 'https://a.example/1', title: 'x', fetchedAt: now },
      { sourceId: a.id, url: 'https://a.example/2', title: 'y', fetchedAt: now },
      { sourceId: b.id, url: 'https://b.example/1', title: 'z', fetchedAt: now },
    ]).run();
    const rows = sourceVolume(7);
    expect(rows[0]).toMatchObject({ name: 'Feed A', total7d: 2 });
    expect(rows[0].daily).toHaveLength(7);
    expect(rows[0].daily[6]).toBe(2);
    expect(rows[1]).toMatchObject({ name: 'Feed B', total7d: 1 });
  });
});

describe('sanitizers', () => {
  it('sanitizeEntities enforces shape, dedup, cap and kinds', () => {
    expect(sanitizeEntities(null)).toEqual([]);
    expect(sanitizeEntities('x')).toEqual([]);
    const out = sanitizeEntities([
      { name: 'GPT-5.2', kind: 'model' },
      { name: 'gpt-5.2', kind: 'model' }, // dup (case)
      { name: '  ', kind: 'model' }, // empty
      { name: 'Claude Code', kind: 'weird-kind' }, // kind falls back
      ...Array.from({ length: 10 }, (_, i) => ({ name: `E${i}`, kind: 'org' })),
    ]);
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ name: 'GPT-5.2', kind: 'model' });
    expect(out[1]).toEqual({ name: 'Claude Code', kind: 'model' });
  });

  it('sanitizeInsights enforces shape, direction fallback and cap', () => {
    expect(sanitizeInsights(undefined)).toEqual([]);
    const out = sanitizeInsights([
      { headline: 'Open-weights closing the gap', detail: 'Evidence.', direction: 'up', domain: 'coding' },
      { headline: 'Weird direction', detail: 'Evidence.', direction: 'sideways' },
      { headline: 'Bad domain', detail: 'Evidence.', direction: 'down', domain: 'nonsense' },
      { headline: '', detail: 'no headline' },
      ...Array.from({ length: 8 }, (_, i) => ({ headline: `H${i}`, detail: 'd', direction: 'watch' })),
    ]);
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({ direction: 'up', domain: 'coding' });
    expect(out[1].direction).toBe('watch');
    expect(out[2].domain).toBeUndefined();
  });
});
