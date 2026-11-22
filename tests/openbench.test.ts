import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { benchmarkSnapshots, metricPoints } from '@/lib/db/schema';
import {
  liveBenchEntityName,
  liveBenchPoints,
  liveBenchSuitePoints,
  liveBenchReleaseCandidates,
  metricsFromOpenRouter,
  runOpenBenchJob,
  runOpenBenchSync,
  SEED_MODELS,
  seedPoints,
  type FetchTextFn,
} from '@/lib/ingest/openbench';
import { normalizeModelKey } from '@/lib/analytics';
import { useTestDb } from './helpers/db';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

const failingFetcher: FetchTextFn = async (url) => {
  throw new Error(`offline test — no fetch for ${url}`);
};

/** Serves every live source from fixtures / inline stubs, keyed by URL. */
const offlineFetcher: FetchTextFn = async (url) => {
  if (url.includes('openrouter.ai')) return fixture('openbench-openrouter.json');
  if (url === 'https://livebench.ai/') return '<script src="./static/js/main.deadbeef.js"></script>';
  // v1 dated releases sit alongside the 2.0 id array — only the 8-digit ids are releases
  if (url.includes('/static/js/main.deadbeef.js'))
    return 'var v1=["2024-07-26","2026-06-25"],Yt=["20261014","20261106"];';
  if (url === 'https://livebench.ai/data/20261106/table.csv') return fixture('openbench-livebench-table.csv');
  if (url === 'https://livebench.ai/data/20261106/categories.json') return fixture('openbench-livebench-categories.json');
  throw new Error(`unexpected url: ${url}`);
};

describe('openrouter parsing', () => {
  it('maps per-token pricing strings to USD per 1M and skips junk rows', () => {
    const points = metricsFromOpenRouter(JSON.parse(fixture('openbench-openrouter.json')));
    const get = (entity: string, metric: string) => points.find((p) => p.entity === entity && p.metric === metric);

    expect(points).toHaveLength(9);
    expect(get('openai/gpt-5.5', 'price_in')).toMatchObject({ source: 'openrouter', value: 5 });
    expect(get('openai/gpt-5.5', 'price_out')).toMatchObject({ source: 'openrouter', value: 30 });
    expect(get('anthropic/claude-sonnet-4.5', 'price_in')?.value).toBeCloseTo(3, 8);
    expect(get('anthropic/claude-sonnet-4.5', 'price_out')?.value).toBeCloseTo(15, 8);
    expect(get('google/gemini-2.5-pro', 'price_in')?.value).toBeCloseTo(1.25, 8);
    expect(get('google/gemini-2.5-pro', 'price_out')?.value).toBeCloseTo(10, 8);
    // free tier keeps explicit zeros
    expect(get('meta-llama/llama-4-maverick:free', 'price_in')?.value).toBe(0);
    expect(get('meta-llama/llama-4-maverick:free', 'price_out')?.value).toBe(0);
    // null pricing → no rows at all
    expect(points.filter((p) => p.entity === 'deepseek/deepseek-v3.2')).toHaveLength(0);
    // malformed prompt string skipped, valid completion kept
    const broken = points.filter((p) => p.entity === 'broken/model');
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ metric: 'price_out', value: 1 });
  });

  it('returns [] for unparseable payloads', () => {
    expect(metricsFromOpenRouter({})).toEqual([]);
    expect(metricsFromOpenRouter(null)).toEqual([]);
    expect(metricsFromOpenRouter('garbage')).toEqual([]);
  });
});

describe('livebench parsing', () => {
  const table = fixture('openbench-livebench-table.csv');
  const categories = fixture('openbench-livebench-categories.json');

  it('computes the release-weighted global score for every model; blanks are not zeros', () => {
    const points = liveBenchPoints(table, categories);
    const byEntity = Object.fromEntries(points.map((p) => [p.entity, p.value]));

    expect(points.every((p) => p.source === 'open-bench' && p.metric === 'livebench')).toBe(true);
    // weights: Long Agentic 2, Coding 1.5, others 1 → (2*80 + 90 + 1.5*88 + 70) / 5.5
    expect(byEntity['GPT 6.2 Astra']).toBeCloseTo(((2 * 80 + 90 + 1.5 * 88 + 70) / 5.5), 2);
    // a blank browser cell drops that suite from numerator AND denominator
    expect(byEntity['Claude Fable 5.2']).toBeCloseTo((2 * 82.9 + 88.8 + 1.5 * 79.2) / 4.5, 2);
    // trailing snapshot stamp dropped, rows with no scores skipped
    expect(byEntity['Deepseek V4.1 Flash']).toBeDefined();
    expect(Object.keys(byEntity).some((e) => e.toLowerCase().includes('broken'))).toBe(false);
    expect(points).toHaveLength(4);
  });

  it('without _overall_weights every suite counts once', () => {
    const plain = JSON.stringify({ Coding: ['coding'], Reasoning: ['reasoning'] });
    const csv = ['model,coding,reasoning', 'claude-opus-5.5,80,90'].join('\n');
    const [p] = liveBenchPoints(csv, plain);
    expect(p).toMatchObject({ entity: 'Claude Opus 5.5', value: 85 });
  });

  it('names slugs so they join other sources via normalizeModelKey', () => {
    expect(liveBenchEntityName('claude-fable-5.2')).toBe('Claude Fable 5.2');
    expect(liveBenchEntityName('gpt-6.2-astra')).toBe('GPT 6.2 Astra');
    expect(normalizeModelKey(liveBenchEntityName('claude-fable-5.2'))).toBe(normalizeModelKey('Claude Fable 5.2'));
  });

  it('discovers only the newest 8-digit 2.0 release ids, newest first', async () => {
    const ids = await liveBenchReleaseCandidates(offlineFetcher);
    expect(ids).toEqual(['20261106', '20261014']);
  });

  it('returns [] for empty tables and empty category maps', () => {
    expect(liveBenchPoints('', categories)).toEqual([]);
    expect(liveBenchPoints(['model,coding', 'x,1'].join('\n'), '{}')).toEqual([]);
  });
});

describe('seed-table path', () => {
  it('records seed rows and reports live sources failed when every fetch throws', async () => {
    const db = useTestDb();
    const stats = await runOpenBenchSync(failingFetcher);
    const byName = Object.fromEntries(stats.sources.map((s) => [s.name, s]));

    expect(byName['openrouter'].ok).toBe(false);
    expect(byName['openrouter'].error).toContain('offline test');
    expect(byName['open-bench-livebench'].ok).toBe(false);
    expect(byName['open-bench-seed'].ok).toBe(true);
    expect(stats.recorded).toBe(seedPoints().length);

    const rows = db.select().from(metricPoints).all();
    expect(rows).toHaveLength(seedPoints().length);
    expect(rows.every((r) => r.source === 'open-bench')).toBe(true);
    expect(new Set(rows.map((r) => r.metric))).toEqual(
      new Set(['intelligence', 'elo', 'image_elo', 'video_elo']),
    );

    // audit row only for the source that produced data
    const snaps = db.select().from(benchmarkSnapshots).all();
    expect(snaps.map((s) => s.source)).toEqual(['open-bench-seed']);
  });
});

describe('full sync (offline fetcher)', () => {
  it('records openrouter + open-bench rows, writes audit snapshots, idempotent same-day', async () => {
    const db = useTestDb();
    const stats = await runOpenBenchSync(offlineFetcher);

    expect(stats.sources.every((s) => s.ok)).toBe(true);
    expect(stats.sources.find((s) => s.name === 'open-bench-livebench')).toMatchObject({ release: '2026-11-06' });

    const rows = db.select().from(metricPoints).all();
    const get = (source: string, entity: string, metric: string) =>
      rows.find((r) => r.source === source && r.entity === entity && r.metric === metric);

    // openrouter per-token → per-1M math lands in the DB
    expect(get('openrouter', 'openai/gpt-5.5', 'price_in')?.value).toBe(5);
    expect(get('openrouter', 'openai/gpt-5.5', 'price_out')?.value).toBe(30);

    // seed composite and live augmentation coexist under distinct metric keys
    const seedGpt = SEED_MODELS.find((m) => m.entity === 'GPT-5.5');
    expect(get('open-bench', 'GPT-5.5', 'intelligence')?.value).toBe(seedGpt?.intelligence);
    expect(get('open-bench', 'GPT 6.2 Astra', 'livebench')?.value).toBeCloseTo(82.18, 2);
    expect(get('open-bench', 'Claude Sonnet 4.5', 'elo')?.value).toBe(
      SEED_MODELS.find((m) => m.entity === 'Claude Sonnet 4.5')?.elo,
    );

    // media arenas covered
    expect(get('open-bench', 'GPT Image 1.5', 'image_elo')).toBeDefined();
    expect(get('open-bench', 'Veo 3.1', 'video_elo')).toBeDefined();

    // audit rows per source, openrouter raw kept (truncated ≤ ~50KB)
    const snaps = db.select().from(benchmarkSnapshots).all();
    expect(snaps.map((s) => s.source).sort()).toEqual(['open-bench-livebench', 'open-bench-seed', 'openrouter']);
    const orSnap = snaps.find((s) => s.source === 'openrouter');
    expect(orSnap?.raw.length).toBeLessThanOrEqual(50_000);
    expect(orSnap?.raw).toContain('openai/gpt-5.5');

    // same-day re-run upserts in place — no new metric rows
    expect(stats.recorded).toBe(rows.length);
    const again = await runOpenBenchSync(offlineFetcher);
    expect(again.recorded).toBe(rows.length);
    expect(db.select().from(metricPoints).all()).toHaveLength(rows.length);
  });

  it('one failing source never aborts the others', async () => {
    const db = useTestDb();
    const partial: FetchTextFn = async (url) => {
      if (url.includes('openrouter.ai')) return 'this is not json';
      return offlineFetcher(url);
    };
    const stats = await runOpenBenchSync(partial);
    const byName = Object.fromEntries(stats.sources.map((s) => [s.name, s]));

    expect(byName['openrouter'].ok).toBe(false);
    expect(byName['open-bench-livebench'].ok).toBe(true);
    expect(byName['open-bench-seed'].ok).toBe(true);

    const sources = new Set(db.select().from(metricPoints).all().map((r) => r.source));
    expect(sources).toEqual(new Set(['open-bench']));
  });
});

describe('runOpenBenchJob', () => {
  it('records everything it can, then fails the run when a live source failed', async () => {
    const db = useTestDb();
    const noLiveBench: FetchTextFn = async (url) => {
      if (url.includes('livebench.ai/data/')) throw new Error('HTTP 404');
      return offlineFetcher(url);
    };
    await expect(runOpenBenchJob(noLiveBench)).rejects.toThrow(/open-bench-livebench/);
    // the seed and openrouter rows still landed before the run was failed
    expect(db.select().from(metricPoints).all().length).toBeGreaterThan(seedPoints().length);
  });

  it('succeeds when every source is healthy', async () => {
    useTestDb();
    const stats = await runOpenBenchJob(offlineFetcher);
    expect(stats.sources.every((x) => x.ok)).toBe(true);
  });
});

describe('livebench per-suite points', () => {
  it('emits one raw metric per suite column per model, skipping blanks', () => {
    const table = ['model,long_agentic,coding,browser', 'claude-fable-5.2,82.9,79.2,', 'gemini-4-neon,82.6,89.7,95.6'].join('\n');
    const cats = JSON.stringify({ 'Long Agentic': ['long_agentic'], Coding: ['coding'], Browser: ['browser'], _overall_weights: { Coding: 2 } });
    const points = liveBenchSuitePoints(table, cats);
    const get = (entity: string, metric: string) => points.find((p) => p.entity === entity && p.metric === metric)?.value;
    expect(get('Claude Fable 5.2', 'livebench_coding')).toBe(79.2);
    expect(get('Gemini 4 Neon', 'livebench_browser')).toBe(95.6);
    expect(get('Claude Fable 5.2', 'livebench_browser')).toBeUndefined(); // blank is not 0
    expect(points.every((p) => p.source === 'open-bench')).toBe(true);
    expect(points).toHaveLength(5);
  });
});
