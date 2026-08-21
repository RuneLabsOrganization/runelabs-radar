import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { braveSearch, braveSearchBatch, BraveSearchError } from '@/lib/search/brave';

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
