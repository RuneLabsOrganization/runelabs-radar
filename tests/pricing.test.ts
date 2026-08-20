import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { benchmarkSnapshots, metricPoints } from '@/lib/db/schema';
import {
  MANUAL_FALLBACK,
  PRICING_SOURCE,
  PROVIDERS,
  parseAnthropicPricing,
  parseDeepSeekPricing,
  parseGooglePricing,
  parseMiniMaxPricing,
  parseMoonshotPricing,
  parseOpenAiPricing,
  parseQwenPricing,
  runPricingSync,
  type ParsedPrice,
  type PriceFetcher,
} from '@/lib/ingest/pricing';
import { useTestDb } from './helpers/db';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

/** Offline fetcher: url → page body; unmapped URLs throw like a failed fetch. */
function stubFetcher(routes: Record<string, string>): PriceFetcher {
  return async (url) => {
    const body = routes[url];
    if (body == null) throw new Error(`HTTP 500 fetching ${url}`);
    return body;
  };
}

function allFixtures(): Record<string, string> {
  return Object.fromEntries(PROVIDERS.map((p) => [p.url, fixture(`pricing-${p.key}.html`)]));
}

/** parsed rows: openai 4, anthropic 4, google 4, deepseek 6, moonshot 4, minimax 3, qwen 4 */
const EXPECTED_POINTS = 29;

describe('pricing parsers', () => {
  const cases: { key: string; parse: (html: string) => ParsedPrice[]; expected: ParsedPrice[] }[] = [
    {
      key: 'openai',
      parse: parseOpenAiPricing,
      expected: [
        { model: 'GPT-5.5 mini', priceIn: 0.35, priceOut: 1.4 },
        { model: 'GPT-5.5', priceIn: 9.5, priceOut: 14 },
      ],
    },
    {
      key: 'anthropic',
      parse: parseAnthropicPricing,
      expected: [
        { model: 'Claude Opus 5', priceIn: 14, priceOut: 70 },
        { model: 'Claude Sonnet 4.5', priceIn: 3, priceOut: 15 },
      ],
    },
    {
      key: 'google',
      parse: parseGooglePricing,
      expected: [
        { model: 'Gemini 3 Pro', priceIn: 1.8, priceOut: 12 },
        { model: 'Gemini 3 Flash', priceIn: 0.3, priceOut: 2.5 },
      ],
    },
    {
      key: 'deepseek',
      parse: parseDeepSeekPricing,
      expected: [
        { model: 'DeepSeek-V4', priceCacheHit: 0.06, priceIn: 0.55, priceOut: 1.7 },
        { model: 'DeepSeek-R2', priceCacheHit: 0.15, priceIn: 1.2, priceOut: 4.5 },
      ],
    },
    {
      key: 'moonshot',
      parse: parseMoonshotPricing,
      expected: [
        { model: 'Kimi K3', priceIn: 0.55, priceOut: 2.4 },
        { model: 'Kimi K3 Turbo', priceIn: 0.9, priceOut: 3.6 },
      ],
    },
    {
      key: 'minimax',
      parse: parseMiniMaxPricing,
      expected: [{ model: 'MiniMax-M2', priceCacheHit: 0.02, priceIn: 0.28, priceOut: 1.1 }],
    },
    {
      key: 'qwen',
      parse: parseQwenPricing,
      expected: [
        { model: 'Qwen4-Max', priceIn: 1.5, priceOut: 6 },
        { model: 'Qwen4-Plus', priceIn: 0.35, priceOut: 1.05 },
      ],
    },
  ];

  for (const { key, parse, expected } of cases) {
    it(`${key}: fixture table → expected rows`, () => {
      expect(parse(fixture(`pricing-${key}.html`))).toEqual(expected);
    });
  }

  it('picks exact model rows: GPT-5.5 never steals gpt-5.5-mini’s row, unrelated rows ignored', () => {
    const out = parseOpenAiPricing(fixture('pricing-openai.html'));
    expect(out).toHaveLength(2); // gpt-image-2 row is not requested
    expect(out.find((p) => p.model === 'GPT-5.5 mini')?.priceIn).toBe(0.35);
    expect(out.find((p) => p.model === 'GPT-5.5')?.priceIn).toBe(9.5);
  });

  it('reads Anthropic output from the last column, past the cache columns', () => {
    const out = parseAnthropicPricing(fixture('pricing-anthropic.html'));
    expect(out.find((p) => p.model === 'Claude Opus 5')?.priceOut).toBe(70);
  });

  it('yields zero rows for changed / JS-rendered markup', () => {
    const shell = '<html><body><div id="__next"><span>Loading…</span></div></body></html>';
    for (const { parse } of cases) expect(parse(shell)).toEqual([]);
  });
});

describe('runPricingSync', () => {
  beforeEach(() => {
    useTestDb();
  });

  it('records parsed prices for every provider plus one audit snapshot each', async () => {
    const stats = await runPricingSync(stubFetcher(allFixtures()));
    expect(stats.errors).toEqual({});
    expect(stats.fallback).toEqual([]);
    expect(stats.providers).toBe(PROVIDERS.length);
    expect(stats.recorded).toBe(EXPECTED_POINTS);

    const db = getDb();
    const rows = db.select().from(metricPoints).where(eq(metricPoints.source, PRICING_SOURCE)).all();
    expect(rows).toHaveLength(EXPECTED_POINTS);
    expect(rows.every((r) => r.source === 'provider-pricing')).toBe(true);
    // fixture page prices differ from the manual map — these prove the parse path
    expect(rows.find((r) => r.entity === 'GPT-5.5' && r.metric === 'price_in')?.value).toBe(9.5);
    expect(rows.find((r) => r.entity === 'MiniMax-M2' && r.metric === 'price_cache_hit')?.value).toBe(0.02);
    // cache-hit prices only where published: DeepSeek (2 models) + MiniMax (1)
    expect(rows.filter((r) => r.metric === 'price_cache_hit')).toHaveLength(3);

    const snaps = db.select().from(benchmarkSnapshots).all();
    expect(snaps.map((s) => s.source).sort()).toEqual(PROVIDERS.map((p) => `pricing-${p.key}`).sort());
    expect(snaps.every((s) => s.raw.length > 0 && s.fetchedAt instanceof Date)).toBe(true);
  });

  it('is idempotent when re-run the same day (upsert, no dupes)', async () => {
    const fetcher = stubFetcher(allFixtures());
    await runPricingSync(fetcher);
    const again = await runPricingSync(fetcher);
    expect(again.recorded).toBe(EXPECTED_POINTS);
    const db = getDb();
    expect(db.select().from(metricPoints).where(eq(metricPoints.source, PRICING_SOURCE)).all()).toHaveLength(
      EXPECTED_POINTS,
    );
  });

  it('falls back to the manual map when a page parses to zero rows', async () => {
    const routes = allFixtures();
    routes[PROVIDERS.find((p) => p.key === 'anthropic')!.url] =
      '<html><body><div id="__next"></div></body></html>';
    const stats = await runPricingSync(stubFetcher(routes));
    expect(stats.fallback).toEqual(['anthropic']);
    expect(stats.errors).toEqual({});

    const db = getDb();
    const rows = db.select().from(metricPoints).where(eq(metricPoints.source, PRICING_SOURCE)).all();
    // manual-map price (15), not the fixture page price (14)
    expect(rows.find((r) => r.entity === 'Claude Opus 5' && r.metric === 'price_in')?.value).toBe(15);
    expect(rows.find((r) => r.entity === 'Claude Sonnet 4.5' && r.metric === 'price_out')?.value).toBe(15);

    const snap = db
      .select()
      .from(benchmarkSnapshots)
      .where(eq(benchmarkSnapshots.source, 'pricing-anthropic'))
      .all();
    expect(snap).toHaveLength(1);
    expect(JSON.parse(snap[0].raw)).toMatchObject({ fallback: true });
  });

  it('isolates a provider fetch failure: records the rest, notes the error', async () => {
    const routes = allFixtures();
    delete routes[PROVIDERS.find((p) => p.key === 'google')!.url];
    const stats = await runPricingSync(stubFetcher(routes));
    expect(Object.keys(stats.errors)).toEqual(['google']);
    expect(stats.fallback).toEqual([]);
    expect(stats.providers).toBe(PROVIDERS.length - 1);
    expect(stats.recorded).toBe(EXPECTED_POINTS - 4); // google contributes 2 models × 2 prices

    const db = getDb();
    const rows = db.select().from(metricPoints).where(eq(metricPoints.source, PRICING_SOURCE)).all();
    expect(rows).toHaveLength(EXPECTED_POINTS - 4);
    expect(rows.some((r) => r.entity.startsWith('Gemini'))).toBe(false);
  });
});

it('manual fallback map covers every provider', () => {
  for (const p of PROVIDERS) {
    expect(MANUAL_FALLBACK[p.key]?.length ?? 0).toBeGreaterThan(0);
  }
});
