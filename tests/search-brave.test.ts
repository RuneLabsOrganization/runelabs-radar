import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { braveSearch, braveSearchBatch, BraveSearchError, resetBraveQuotaGate } from '@/lib/search/brave';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

function stubFetch(body: string, status = 200) {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(body, { status });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetBraveQuotaGate();
});

describe('braveSearch', () => {
  beforeEach(() => {
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key');
  });

  it('maps news results from /res/v1/news/search', async () => {
    const fn = stubFetch(fixture('brave-news.json'));
    const hits = await braveSearch({ query: 'AI coding assistant OR code model', kind: 'news' });
    const url = String(fn.mock.calls[0][0]);
    expect(url).toContain('api.search.brave.com/res/v1/news/search');
    expect(hits).toHaveLength(2);
    expect(hits[0]!.title).toContain('GPT-5.4');
  });

  it('maps web results from /res/v1/web/search', async () => {
    const fn = stubFetch(fixture('brave-web.json'));
    const hits = await braveSearch({ query: 'Claude Code Cursor', kind: 'web', freshness: 'pw' });
    const url = String(fn.mock.calls[0][0]);
    expect(url).toContain('api.search.brave.com/res/v1/web/search');
    expect(url).toContain('freshness=pw');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.description).toContain('46%');
    expect(hits[0]!.description).toContain('19%');
  });

  it('throws without BRAVE_API_KEY', async () => {
    vi.stubEnv('BRAVE_API_KEY', '');
    await expect(braveSearch({ query: 'AI' })).rejects.toBeInstanceOf(BraveSearchError);
  });

  it('surfaces Brave 402 USAGE_LIMIT_EXCEEDED as a quota error, once', async () => {
    const body = JSON.stringify({
      type: 'ErrorResponse',
      error: {
        status: 402,
        detail: 'Usage limit exceeded.',
        meta: { plan: 'Search', current_spend: 5, usage_limit: 5, usage_limit_type: 'monthly' },
        code: 'USAGE_LIMIT_EXCEEDED',
      },
    });
    const fn = vi.fn(async () => {
      return new Response(body, {
        status: 402,
        headers: { 'x-ratelimit-reset': '1, 3600' },
      });
    });
    vi.stubGlobal('fetch', fn);

    await expect(braveSearch({ query: 'AI' })).rejects.toThrow(/USAGE_LIMIT_EXCEEDED.*\$5\/\$5/i);
    expect(fn).toHaveBeenCalledTimes(1);

    await expect(braveSearch({ query: 'AI' })).rejects.toThrow(/quota exhausted/i);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('braveSearchBatch', () => {
  beforeEach(() => {
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key');
  });

  it('dedupes by url and keeps going after a failed query', async () => {
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('fail-query')) return new Response('nope', { status: 400 });
      return new Response(fixture('brave-web.json'), { status: 200 });
    });
    vi.stubGlobal('fetch', fn);
    const { hits, queriesOk, queriesFailed } = await braveSearchBatch([
      { query: 'Claude Code Cursor', kind: 'web' },
      { query: 'fail-query', kind: 'news' },
      { query: 'Claude Code Cursor', kind: 'web' },
    ]);
    expect(queriesOk).toBe(2);
    expect(queriesFailed).toBe(1);
    expect(hits).toHaveLength(1);
  });
});
