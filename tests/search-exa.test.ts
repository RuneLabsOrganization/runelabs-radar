import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exaSearch, ExaSearchError } from '@/lib/search/exa';

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

describe('exaSearch', () => {
  beforeEach(() => {
    vi.stubEnv('EXA_API_KEY', 'test-exa-key');
  });

  it('posts to /search with the api key header and maps results', async () => {
    const fn = stubFetch(fixture('exa-search.json'));
    const hits = await exaSearch({ query: 'AI coding assistant OR code model' });

    const [url, init] = fn.mock.calls[0]!;
    expect(String(url)).toBe('https://api.exa.ai/search');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe('test-exa-key');
    const body = JSON.parse(String(init?.body));
    expect(body.query).toBe('AI coding assistant OR code model');
    expect(body.contents).toEqual({ highlights: true });

    expect(hits).toHaveLength(2); // result without a title is skipped
    expect(hits[0]).toEqual({
      url: 'https://techcrunch.com/2026/08/12/openai-gpt-5-4-agentic-coding/',
      title: 'OpenAI ships GPT-5.4 with a persistent coding agent',
      description: 'The new model keeps a coding agent running across sessions.',
      publishedAt: new Date('2026-08-12T15:04:05.000Z'),
    });
  });

  it('falls back to the text field when there are no highlights', async () => {
    stubFetch(fixture('exa-search.json'));
    const hits = await exaSearch({ query: 'x' });
    expect(hits[1]!.description).toContain('$9.9B');
  });

  it('has no publishedAt when publishedDate is absent', async () => {
    stubFetch(fixture('exa-search.json'));
    const hits = await exaSearch({ query: 'x' });
    expect(hits[1]!.publishedAt).toBeNull();
  });

  it('caps numResults at MAX_COUNT and floors invalid input to DEFAULT_COUNT', async () => {
    const fn = stubFetch(fixture('exa-search.json'));
    await exaSearch({ query: 'x', count: 999 });
    expect(JSON.parse(String(fn.mock.calls[0]![1]?.body)).numResults).toBe(25);

    await exaSearch({ query: 'x', count: Number.NaN });
    expect(JSON.parse(String(fn.mock.calls[1]![1]?.body)).numResults).toBe(10);
  });

  it('throws without EXA_API_KEY', async () => {
    vi.stubEnv('EXA_API_KEY', '');
    await expect(exaSearch({ query: 'AI' })).rejects.toBeInstanceOf(ExaSearchError);
  });

  it('propagates an HTTP error so the ingest adapter can decide to fall back', async () => {
    // 403, not 429/5xx — those are retried by fetchWithTimeout and would slow the test
    stubFetch('forbidden', 403);
    await expect(exaSearch({ query: 'AI' })).rejects.toThrow();
  });
});
