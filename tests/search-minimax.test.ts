import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { minimaxSearch } from '@/lib/search/minimax';
import { resetExaQuotaGate } from '@/lib/search/exa';
import { adapters } from '@/lib/ingest/adapters';
import type { Source } from '@/lib/ingest/types';
import { useTestDb } from './helpers/db';

const searchResults = {
  base_resp: { status_code: 0 },
  organic: [
    { title: 'A', link: 'https://a.example/1', date: 'Nov 13, 2026', snippet: 'alpha' },
    { title: 'B', link: 'https://b.example/2', date: '4 days ago', snippet: 'beta' },
    { title: 'A dup', link: 'https://a.example/1', snippet: 'dup' },
    { title: 'C', link: 'https://c.example/3', snippet: null },
  ],
};

function source(config: object): Source {
  return { id: 1, type: 'exa', name: 'Search — T', config: JSON.stringify(config), domainHints: '[]', enabled: true } as unknown as Source;
}

beforeEach(() => {
  useTestDb();
  vi.stubEnv('MINIMAX_API_KEY', 'mm-key');
  vi.stubEnv('EXA_API_KEY', 'exa-key');
});
afterEach(() => {
  resetExaQuotaGate();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('minimaxSearch', () => {
  it('posts the query to the MiniMax search API and deduplicates organic results', async () => {
    const fn = vi.fn(async () => new Response(JSON.stringify(searchResults), { status: 200 }));
    vi.stubGlobal('fetch', fn);
    const hits = await minimaxSearch({ query: 'ai coding' });
    expect(hits.map((h) => h.url)).toEqual(['https://a.example/1', 'https://b.example/2', 'https://c.example/3']);
    expect(hits[0]!.publishedAt?.getUTCFullYear()).toBe(2026);
    expect(hits[1]!.publishedAt).toBeNull(); // "4 days ago" is not a date
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v1/coding_plan/search');
    expect(JSON.parse(String(init.body))).toEqual({ q: 'ai coding' });
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer mm-key');
  });

  it('surfaces provider errors returned with HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ base_resp: { status_code: 1004 } })));
    await expect(minimaxSearch({ query: 'q' })).rejects.toThrow('1004');
  });

  it('respects count', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(searchResults), { status: 200 })));
    expect(await minimaxSearch({ query: 'q', count: 1 })).toHaveLength(1);
  });
});

describe('exa adapter → MiniMax fallback', () => {
  it('uses MiniMax search when Exa answers 402, never touching Brave', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'brave-key');
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('api.exa.ai')) return new Response('no credit', { status: 402 });
      if (u.includes('minimax')) return new Response(JSON.stringify(searchResults), { status: 200 });
      throw new Error(`unexpected fetch ${u}`);
    });
    vi.stubGlobal('fetch', fn);
    const out = await adapters.exa.fetchItems(source({ query: 'ai coding' }));
    expect(out.map((i) => i.title)).toEqual(['A', 'B', 'C']);
    expect(fn.mock.calls.some((c) => String(c[0]).includes('brave'))).toBe(false);
  });
});
