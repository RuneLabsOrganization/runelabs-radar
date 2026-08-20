import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boardEntries, metricPoints, opportunities, stories } from '@/lib/db/schema';
import { _resetRateLimits } from '@/lib/api-limit';
import { GET as signalsGet } from '@/app/api/v1/signals/route';
import { GET as boardGet } from '@/app/api/v1/board/route';
import { GET as opportunitiesGet } from '@/app/api/v1/opportunities/route';
import { GET as metricsGet } from '@/app/api/v1/metrics/route';
import { useTestDb } from './helpers/db';

let db: ReturnType<typeof useTestDb>;

const ORIG_ENV = { API_RATE_LIMIT: process.env.API_RATE_LIMIT, AA_PUBLIC: process.env.AA_PUBLIC };

beforeEach(() => {
  db = useTestDb();
  _resetRateLimits();
  delete process.env.API_RATE_LIMIT;
  delete process.env.AA_PUBLIC;
});

afterEach(() => {
  for (const k of ['API_RATE_LIMIT', 'AA_PUBLIC'] as const) {
    const v = ORIG_ENV[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function req(path: string, ip?: string): Request {
  return new Request(`http://localhost${path}`, ip ? { headers: { 'x-forwarded-for': ip } } : undefined);
}

function seedStory(o: {
  title: string;
  status?: 'raw' | 'curated' | 'filtered';
  topScore?: number;
  domainScores?: Record<string, number>;
  createdAt?: Date;
}): void {
  db.insert(stories)
    .values({
      title: o.title,
      tldr: `tldr: ${o.title}`,
      whyItMatters: 'it matters',
      status: o.status ?? 'curated',
      topScore: o.topScore ?? 80,
      domainScores: o.domainScores ? JSON.stringify(o.domainScores) : null,
      createdAt: o.createdAt ?? new Date(),
    })
    .run();
}

function seedOpp(o: { slug: string; flipScore: number; status?: 'active' | 'archived'; planRuns?: number }): void {
  db.insert(opportunities)
    .values({
      slug: o.slug,
      title: `Opening ${o.slug}`,
      thesis: `Thesis for ${o.slug}.`,
      sector: 'devtools',
      status: o.status ?? 'active',
      flipScore: o.flipScore,
      holdScore: 50,
      scores: JSON.stringify({ demand: 12 }),
      evidence: '[]',
      verdict: 'pursue',
      confidence: 60,
      planRuns: o.planRuns ?? 0,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    .run();
}

function seedPoint(source: string, entity: string, metric: string, value: number, date: string): void {
  db.insert(metricPoints).values({ source, entity, metric, value, date, createdAt: new Date() }).run();
}

const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

describe('GET /api/v1/signals', () => {
  it('returns recent curated stories with the public shape and cache header', async () => {
    seedStory({ title: 'curated one', topScore: 90 });
    seedStory({ title: 'curated two', topScore: 70 });
    seedStory({ title: 'still raw', status: 'raw', topScore: 99 });
    seedStory({ title: 'too old', createdAt: new Date(Date.now() - 96 * 36e5) });
    const res = await signalsGet(req('/api/v1/signals'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
    const body = await res.json();
    expect(body).toMatchObject({ window_hours: 72, domain: 'all', count: 2 });
    expect(body.signals.map((s: { title: string }) => s.title)).toEqual(['curated one', 'curated two']);
    const s0 = body.signals[0];
    expect(s0).toMatchObject({ score: 90, tldr: 'tldr: curated one', why_it_matters: 'it matters' });
    expect(typeof s0.id).toBe('number');
    expect(s0.created_at.startsWith('20')).toBe(true);
    expect(s0.url).toContain(`/story/${s0.id}`);
  });

  it('filters by domain membership score and reports the domain score', async () => {
    seedStory({ title: 'coding story', domainScores: { coding: 85, copy: 10 } });
    seedStory({ title: 'not coding', domainScores: { coding: 10 } });
    seedStory({ title: 'no scores' });
    const res = await signalsGet(req('/api/v1/signals?domain=coding'));
    const body = await res.json();
    expect(body).toMatchObject({ domain: 'coding', count: 1 });
    expect(body.signals[0]).toMatchObject({ title: 'coding story', score: 85 });
  });

  it('clamps limit to 50', async () => {
    for (let i = 0; i < 55; i++) seedStory({ title: `story ${i}`, topScore: 50 + (i % 10) });
    const res = await signalsGet(req('/api/v1/signals?limit=999'));
    const body = await res.json();
    expect(body.count).toBe(50);
    expect(body.signals).toHaveLength(50);
  });

  it('rejects an unknown domain with a 400 error body', async () => {
    const res = await signalsGet(req('/api/v1/signals?domain=nope'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown domain 'nope'" });
  });
});

describe('GET /api/v1/board', () => {
  it('groups entries by domain with per-task picks', async () => {
    db.insert(boardEntries)
      .values({
        domain: 'coding',
        task: 'agentic-coding',
        bestOverall: 'GPT-5.2',
        bestValue: 'GLM-4.7',
        cheapestViable: 'DeepSeek-V4',
        costNote: 'cheap enough',
        runelabsVerdict: 'solid',
        updatedAt: new Date(),
      })
      .run();
    db.insert(boardEntries).values({ domain: 'image', task: 'product-shots', bestOverall: 'Flux 2' }).run();
    const res = await boardGet(req('/api/v1/board'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(Object.keys(body.board)).toEqual(['coding', 'image']);
    expect(body.board.coding[0]).toMatchObject({
      task: 'agentic-coding',
      best_overall: 'GPT-5.2',
      best_value: 'GLM-4.7',
      cheapest_viable: 'DeepSeek-V4',
      cost_note: 'cheap enough',
      verdict: 'solid',
    });
    expect(body.board.image[0]).toMatchObject({ task: 'product-shots', best_value: null });
  });

  it('filters to one domain and rejects unknown domains', async () => {
    db.insert(boardEntries).values({ domain: 'coding', task: 'agentic-coding' }).run();
    db.insert(boardEntries).values({ domain: 'image', task: 'product-shots' }).run();
    const one = await (await boardGet(req('/api/v1/board?domain=image'))).json();
    expect(one.count).toBe(1);
    expect(Object.keys(one.board)).toEqual(['image']);
    const bad = await boardGet(req('/api/v1/board?domain=nope'));
    expect(bad.status).toBe(400);
  });
});

describe('GET /api/v1/opportunities', () => {
  it('returns active opportunities ordered by flip score, with exploring_count', async () => {
    seedOpp({ slug: 'low', flipScore: 50 });
    seedOpp({ slug: 'high', flipScore: 90, planRuns: 4 });
    seedOpp({ slug: 'gone', flipScore: 99, status: 'archived' });
    const res = await opportunitiesGet(req('/api/v1/opportunities'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('s-maxage=60');
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.opportunities.map((o: { slug: string }) => o.slug)).toEqual(['high', 'low']);
    expect(body.opportunities[0]).toMatchObject({
      slug: 'high',
      flip_score: 90,
      hold_score: 50,
      exploring_count: 4,
      verdict: 'pursue',
      has_brief: false,
      has_plan: false,
    });
  });

  it('clamps limit (default 10, cap 50)', async () => {
    for (let i = 0; i < 3; i++) seedOpp({ slug: `o${i}`, flipScore: 60 + i });
    const one = await (await opportunitiesGet(req('/api/v1/opportunities?limit=1'))).json();
    expect(one.count).toBe(1);
    expect(one.opportunities[0].slug).toBe('o2');
    const all = await (await opportunitiesGet(req('/api/v1/opportunities?limit=999'))).json();
    expect(all.count).toBe(3);
  });
});

describe('GET /api/v1/metrics', () => {
  it('enumerates series keys, hiding aa* sources by default', async () => {
    seedPoint('github', 'org/repo', 'stars', 100, TODAY);
    seedPoint('provider-pricing', 'GPT-5', 'price_in', 1.25, TODAY);
    seedPoint('aa', 'GPT-5', 'intelligence', 69, TODAY);
    seedPoint('aa-media-image', 'Flux 2', 'elo', 1100, TODAY);
    const res = await metricsGet(req('/api/v1/metrics'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    const keys = body.metrics.map((m: { source: string }) => m.source);
    expect(keys).toContain('github');
    expect(keys).toContain('provider-pricing');
    expect(keys.some((s: string) => s.startsWith('aa'))).toBe(false);
    expect(body.metrics[0]).toMatchObject({ latest: TODAY, points: 1 });
  });

  it('includes aa* keys in enumeration when AA_PUBLIC=true', async () => {
    process.env.AA_PUBLIC = 'true';
    seedPoint('github', 'org/repo', 'stars', 100, TODAY);
    seedPoint('aa', 'GPT-5', 'intelligence', 69, TODAY);
    const body = await (await metricsGet(req('/api/v1/metrics'))).json();
    expect(body.count).toBe(2);
    expect(body.metrics.map((m: { source: string }) => m.source)).toContain('aa');
  });

  it('returns a series with stats for source+entity+metric', async () => {
    seedPoint('github', 'org/repo', 'stars', 100, YESTERDAY);
    seedPoint('github', 'org/repo', 'stars', 150, TODAY);
    const res = await metricsGet(req('/api/v1/metrics?source=github&entity=org/repo&metric=stars'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ found: true, source: 'github', entity: 'org/repo', metric: 'stars' });
    expect(body.points).toEqual([
      { date: YESTERDAY, value: 100 },
      { date: TODAY, value: 150 },
    ]);
    expect(body.first).toBe(100);
    expect(body.last).toBe(150);
    expect(body.delta).toBe(50);
    expect(body.change_pct).toBe(50);
  });

  it('rejects aa* series requests with 403 unless AA_PUBLIC', async () => {
    seedPoint('aa', 'GPT-5', 'intelligence', 69, TODAY);
    const denied = await metricsGet(req('/api/v1/metrics?source=aa&entity=GPT-5&metric=intelligence'));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "source 'aa' is not available on the public API" });
    const deniedList = await metricsGet(req('/api/v1/metrics?source=aa-media-image'));
    expect(deniedList.status).toBe(403);

    process.env.AA_PUBLIC = 'true';
    const allowed = await metricsGet(req('/api/v1/metrics?source=aa&entity=GPT-5&metric=intelligence'));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ found: true, points: [{ date: TODAY, value: 69 }] });
  });

  it('requires the full source/entity/metric triple for series mode', async () => {
    const res = await metricsGet(req('/api/v1/metrics?source=github&metric=stars'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'source, entity and metric are required together' });
  });
});

describe('rate limit', () => {
  it('429s after API_RATE_LIMIT requests per minute per IP, with retry hints', async () => {
    process.env.API_RATE_LIMIT = '2';
    const ip = '203.0.113.7';
    expect((await signalsGet(req('/api/v1/signals', ip))).status).toBe(200);
    expect((await signalsGet(req('/api/v1/signals', ip))).status).toBe(200);
    const blocked = await signalsGet(req('/api/v1/signals', ip));
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toBe('rate_limited');
    expect(body.retry_after_s).toBeGreaterThanOrEqual(1);
    expect(body.retry_after_s).toBeLessThanOrEqual(60);
    expect(blocked.headers.get('retry-after')).toBe(String(body.retry_after_s));
    // a different first-hop IP has its own bucket
    expect((await signalsGet(req('/api/v1/signals', '203.0.113.8'))).status).toBe(200);
    // reset hook restores a fresh limiter
    _resetRateLimits();
    expect((await signalsGet(req('/api/v1/signals', ip))).status).toBe(200);
  });

  it('uses the first x-forwarded-for hop as the bucket key', async () => {
    process.env.API_RATE_LIMIT = '1';
    const first = await boardGet(req('/api/v1/board', '198.51.100.1, 10.0.0.1'));
    expect(first.status).toBe(200);
    const blocked = await boardGet(req('/api/v1/board', '198.51.100.1, 10.0.0.2'));
    expect(blocked.status).toBe(429);
  });
});
