import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { minimaxSearch } from '@/lib/search/minimax';
import { resetExaQuotaGate } from '@/lib/search/exa';
import { adapters } from '@/lib/ingest/adapters';
import type { Source } from '@/lib/ingest/types';
import { useTestDb } from './helpers/db';

const messages = {
  content: [
    { type: 'thinking', thinking: 'x' },
    { type: 'server_tool_use', name: 'web_search', input: { query: 'q' } },
    {
      type: 'web_search_tool_result',
      content: [
        { type: 'web_search_result', title: 'A', url: 'https://a.example/1', page_age: 'Nov 13, 2026', content: 'alpha' },
        { type: 'web_search_result', title: 'B', url: 'https://b.example/2', page_age: '4 days ago', content: 'beta' },
      ],
    },
    {
      type: 'web_search_tool_result',
      content: [
        { type: 'web_search_result', title: 'A dup', url: 'https://a.example/1', content: 'dup' },
        { type: 'web_search_result', title: 'C', url: 'https://c.example/3', content: null },
      ],
    },
    { type: 'text', text: 'DONE' },
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
  it('posts the web_search server tool and returns deduped hits from result blocks', async () => {
    const fn = vi.fn(async () => new Response(JSON.stringify(messages), { status: 200 }));
    vi.stubGlobal('fetch', fn);
    const hits = await minimaxSearch({ query: 'ai coding' });
    expect(hits.map((h) => h.url)).toEqual(['https://a.example/1', 'https://b.example/2', 'https://c.example/3']);
    expect(hits[0]!.publishedAt?.getUTCFullYear()).toBe(2026);
    expect(hits[1]!.publishedAt).toBeNull(); // "4 days ago" is not a date
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/anthropic/v1/messages');
    expect(JSON.parse(String(init.body)).tools[0].type).toBe('web_search_20250305');
  });

  it('respects count', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(messages), { status: 200 })));
    expect(await minimaxSearch({ query: 'q', count: 1 })).toHaveLength(1);
  });
});

describe('exa adapter → MiniMax fallback', () => {
  it('uses MiniMax search when Exa answers 402, never touching Brave', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'brave-key');
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('api.exa.ai')) return new Response('no credit', { status: 402 });
      if (u.includes('minimax')) return new Response(JSON.stringify(messages), { status: 200 });
      throw new Error(`unexpected fetch ${u}`);
    });
    vi.stubGlobal('fetch', fn);
    const out = await adapters.exa.fetchItems(source({ query: 'ai coding' }));
    expect(out.map((i) => i.title)).toEqual(['A', 'B', 'C']);
    expect(fn.mock.calls.some((c) => String(c[0]).includes('brave'))).toBe(false);
  });
});
