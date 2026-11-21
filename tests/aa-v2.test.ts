import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTestDb } from './helpers/db';
import { getDb } from '@/lib/db';
import { benchmarkSnapshots, jobRuns } from '@/lib/db/schema';

// runSnapshot fetches through the shared adapter; stub only fetchText
const fetchTextMock = vi.fn<(url: string, init?: RequestInit) => Promise<string>>();
vi.mock('@/lib/ingest/adapters/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ingest/adapters/shared')>();
  return { ...actual, fetchText: (url: string, init?: RequestInit) => fetchTextMock(url, init) };
});

import {
  AA_MEDIA_ENDPOINTS,
  AA_URL,
  compactAaMediaSnapshot,
  compactAaSnapshot,
  fetchAaAll,
} from '@/lib/board/sync';
import { runSnapshot } from '@/lib/snapshot';
import { withJobRun } from '@/lib/jobs';

/** A model row as the free-tier V2 /language/models/free endpoint returns it. */
function v2Model(name: string, over: Record<string, unknown> = {}) {
  return {
    id: name,
    name,
    slug: name.toLowerCase(),
    release_date: '2026-11-09',
    model_creator: { id: 'x', name: 'Acme' },
    evaluations: { artificial_analysis_intelligence_index: 60, artificial_analysis_coding_index: null },
    pricing: { price_1m_input_tokens: 4, price_1m_output_tokens: 20, price_1m_cache_hit_tokens: 0.4 },
    performance: { median_output_tokens_per_second: 88.5 },
    ...over,
  };
}

describe('AA V2 (free tier) parsing', () => {
  it('points at the supported free-tier endpoints, not the retired /api/v2/data/*', () => {
    for (const url of [AA_URL, ...AA_MEDIA_ENDPOINTS.map((e) => e.url)]) {
      expect(url).not.toContain('/api/v2/data/');
      expect(url).toMatch(/\/free$/);
    }
  });

  it('derives the 3:1 blended price and reads speed from performance', () => {
    const compact = JSON.parse(compactAaSnapshot(JSON.stringify({ tier: 'free', data: [v2Model('Fable')] })));
    expect(compact.models[0]).toMatchObject({
      name: 'Fable',
      org: 'Acme',
      intelligence: 60,
      price: 8, // (3×4 + 20) / 4 — the formula the legacy price_1m_blended_3_to_1 used
      priceIn: 4,
      priceOut: 20,
      speed: 88.5,
    });
  });

  it('leaves price null when either side of the blend is missing', () => {
    const m = v2Model('Half', { pricing: { price_1m_input_tokens: 1, price_1m_output_tokens: null } });
    const compact = JSON.parse(compactAaSnapshot(JSON.stringify({ data: [m] })));
    expect(compact.models[0].price).toBeNull();
  });

  it('ranks unranked V2 media rows by ELO, best first', () => {
    const raw = JSON.stringify({
      tier: 'free',
      data: [
        { name: 'B', model_creator: { name: 'o' }, elo: 1200, ci_95: 10 },
        { name: 'A', model_creator: { name: 'o' }, elo: 1263, ci_95: 14 },
        { name: 'junk', elo: null },
      ],
    });
    const compact = JSON.parse(compactAaMediaSnapshot(raw));
    expect(compact.models.map((m: { name: string; rank: number }) => [m.name, m.rank])).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
  });
});

describe('fetchAaAll', () => {
  it('follows pagination and merges every page', async () => {
    const seen: string[] = [];
    const get = async (url: string) => {
      seen.push(url);
      const page = Number(new URL(url).searchParams.get('page') ?? '1');
      return JSON.stringify({
        data: [v2Model(`m${page}`)],
        pagination: { page, total_pages: 3, has_more: page < 3 },
      });
    };
    const merged = JSON.parse(await fetchAaAll(AA_URL, get)) as { data: { name: string }[] };
    expect(merged.data.map((m) => m.name)).toEqual(['m1', 'm2', 'm3']);
    expect(seen).toHaveLength(3);
  });

  it('a single unpaginated response passes through', async () => {
    const merged = JSON.parse(await fetchAaAll(AA_URL, async () => JSON.stringify({ data: [{ name: 'x' }] })));
    expect(merged.data).toEqual([{ name: 'x' }]);
  });
});

describe('runSnapshot against V2', () => {
  const savedKey = process.env.AA_API_KEY;
  beforeEach(() => {
    useTestDb();
    process.env.AA_API_KEY = 'test-key';
    fetchTextMock.mockReset();
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.AA_API_KEY;
    else process.env.AA_API_KEY = savedKey;
  });

  it('stores a parseable snapshot and metric points from the V2 shape', async () => {
    fetchTextMock.mockImplementation(async (url: string) =>
      url.includes('/language/')
        ? JSON.stringify({ data: [v2Model('Fable')], pagination: { page: 1, has_more: false } })
        : JSON.stringify({ data: [{ name: 'Img', model_creator: { name: 'o' }, elo: 1200 }] }),
    );
    const res = await runSnapshot();
    expect(res.snapshots).toBe(1 + AA_MEDIA_ENDPOINTS.length);
    expect(res.points).toBeGreaterThan(0);
    const row = getDb().select().from(benchmarkSnapshots).all().find((r) => r.source === 'artificial-analysis')!;
    expect(JSON.parse(row.raw).models[0].price).toBe(8);
  });

  it('records the job as an error when every AA fetch fails (it used to log "ok" with 0/0)', async () => {
    fetchTextMock.mockRejectedValue(new Error('HTTP 410 Gone'));
    await expect(runSnapshot()).rejects.toThrow(/every Artificial Analysis fetch failed/);
    await withJobRun('snapshot', runSnapshot);
    const run = getDb().select().from(jobRuns).all().at(-1)!;
    expect(run.status).toBe('error');
    expect(run.error).toContain('410');
  });

  it('a partial failure still succeeds but names what failed', async () => {
    fetchTextMock.mockImplementation(async (url: string) => {
      if (url.includes('/language/')) return JSON.stringify({ data: [v2Model('Fable')] });
      throw new Error('HTTP 503');
    });
    const res = await runSnapshot();
    expect(res.snapshots).toBe(1);
    expect(res.failed).toEqual(AA_MEDIA_ENDPOINTS.map((e) => e.source));
  });
});
