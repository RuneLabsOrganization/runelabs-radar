import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { items, sources } from '@/lib/db/schema';
import { adapters } from '@/lib/ingest/adapters';
import { runIngest } from '@/lib/ingest/ingest';
import type { Source } from '@/lib/ingest/types';
import { useTestDb } from './helpers/db';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

function makeSource(type: Source['type'], config: Record<string, unknown> = {}): Source {
  return {
    id: 1,
    type,
    name: `test-${type}`,
    config: JSON.stringify(config),
    domainHints: '[]',
    enabled: true,
    lastFetchedAt: null,
    lastStatus: null,
    consecutiveFailures: 0,
    consecutiveEmpty: 0,
  };
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
});

describe('rss adapter', () => {
  it('maps RSS 2.0 items and strips HTML from excerpts', async () => {
    stubFetch(fixture('rss2.xml'));
    const out = await adapters.rss.fetchItems(makeSource('rss', { url: 'https://openai.com/news/rss.xml' }));
    expect(out).toHaveLength(3);
    expect(out[0].url).toBe('https://openai.com/index/introducing-gpt-5-3/');
    expect(out[0].title).toBe('Introducing GPT-5.3');
    expect(out[0].excerpt).toBe(
      'Our most capable model yet, with stronger reasoning and 40% lower latency across coding & agentic tasks.',
    );
    expect(out[0].excerpt).not.toContain('<');
    expect(out[0].publishedAt).toEqual(new Date('2026-07-08T16:00:00Z'));
    expect(out[2].url).toBe('https://openai.com/index/embeddings-pricing-2026/');
    expect(out[2].excerpt).toBe('We are cutting embeddings prices by 60% effective immediately.');
  });

  it('maps Atom entries: alternate link, summary/content fallback, updated/published fallback', async () => {
    stubFetch(fixture('atom.xml'));
    const out = await adapters.rss.fetchItems(makeSource('rss', { url: 'https://simonwillison.net/atom/everything/' }));
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe('Running MiniMax-M2 locally with llama.cpp');
    expect(out[0].url).toBe('https://simonwillison.net/2026/Jul/9/minimax-m2-local/');
    expect(out[0].excerpt).toBe('Notes on quantizing MiniMax-M2 to 4 bits and serving it on a single 4090.');
    expect(out[0].publishedAt).toEqual(new Date('2026-07-09T18:42:00Z'));
    // second entry has rel="self" before rel="alternate", no summary (content only), no published
    expect(out[1].url).toBe('https://simonwillison.net/2026/Jul/8/prompt-injection-agentic-browsers/');
    expect(out[1].excerpt).toBe('A survey of how the new wave of agentic browsers handle untrusted page content.');
    expect(out[1].publishedAt).toEqual(new Date('2026-07-08T09:15:00Z'));
  });

  it('normalizes single-item feeds that parse as an object, not an array', async () => {
    stubFetch(
      '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>' +
        '<item><title>Only story</title><link>https://example.com/only</link>' +
        '<description>Just one.</description><pubDate>Mon, 06 Jul 2026 09:00:00 GMT</pubDate></item>' +
        '</channel></rss>',
    );
    const out = await adapters.rss.fetchItems(makeSource('rss', { url: 'https://example.com/feed' }));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Only story');
    expect(out[0].url).toBe('https://example.com/only');
  });

  it('truncates excerpts to 500 chars and leaves missing pubDate null', async () => {
    const long = 'word '.repeat(300);
    stubFetch(
      '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>' +
        `<item><title>Long</title><link>https://example.com/long</link><description>${long}</description></item>` +
        '</channel></rss>',
    );
    const out = await adapters.rss.fetchItems(makeSource('rss', { url: 'https://example.com/feed' }));
    expect(out[0].excerpt).not.toBeNull();
    expect(out[0].excerpt!.length).toBeLessThanOrEqual(500);
    expect(out[0].publishedAt).toBeNull();
  });

  it('throws on HTTP errors so runIngest records the failure', { timeout: 15000 }, async () => {
    stubFetch('gone', 500);
    await expect(
      adapters.rss.fetchItems(makeSource('rss', { url: 'https://example.com/feed' })),
    ).rejects.toThrow(/500/);
  });

  it('sends conditional headers and returns [] on 304 without erroring', async () => {
    // undici's Response constructor rejects 304 — fake the minimal shape the adapter touches
    const notModified = { status: 304, headers: new Headers(), text: async () => '' } as Response;
    const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => notModified);
    vi.stubGlobal('fetch', fn);
    const cfg = { url: 'https://example.com/feed', etag: '"abc"', lastModified: 'Wed, 01 Jul 2026 00:00:00 GMT' };
    const out = await adapters.rss.fetchItems(makeSource('rss', {}), cfg);
    expect(out).toEqual([]);
    const init = fn.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>)['if-none-match']).toBe('"abc"');
    expect((init.headers as Record<string, string>)['if-modified-since']).toBe('Wed, 01 Jul 2026 00:00:00 GMT');
  });

  it('persists fresh etag/lastModified into cfg after a 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(fixture('rss2.xml'), {
            status: 200,
            headers: { etag: '"v2"', 'last-modified': 'Thu, 09 Jul 2026 00:00:00 GMT' },
          }),
      ),
    );
    const cfg: Record<string, unknown> = { url: 'https://example.com/feed' };
    const out = await adapters.rss.fetchItems(makeSource('rss', {}), cfg);
    expect(out).toHaveLength(3);
    expect(cfg.etag).toBe('"v2"');
    expect(cfg.lastModified).toBe('Thu, 09 Jul 2026 00:00:00 GMT');
  });

  it('retries a 429 and succeeds on the next attempt', { timeout: 15000 }, async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return calls === 1
          ? new Response('busy', { status: 429 })
          : new Response(fixture('rss2.xml'), { status: 200 });
      }),
    );
    const out = await adapters.rss.fetchItems(makeSource('rss', { url: 'https://example.com/feed' }));
    expect(out).toHaveLength(3);
    expect(calls).toBe(2);
  });
});

describe('hn adapter', () => {
  it('maps Algolia hits, falling back to the HN item url', async () => {
    const fn = stubFetch(fixture('hn.json'));
    const out = await adapters.hn.fetchItems(makeSource('hn', { query: 'AI OR LLM', minPoints: 50 }));
    const calledUrl = String(fn.mock.calls[0][0]);
    expect(calledUrl).toContain('hn.algolia.com/api/v1/search_by_date');
    expect(calledUrl).toContain(encodeURIComponent('AI OR LLM'));
    expect(calledUrl).toContain('tags=story');
    expect(calledUrl).toContain(encodeURIComponent('points>=50'));
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      url: 'https://deepseek.com/blog/deepseek-v4',
      title: 'DeepSeek-V4 tops SWE-bench Verified at a tenth of the cost',
      excerpt: null,
      publishedAt: new Date('2026-07-09T14:03:11Z'),
    });
    // hit with url: null falls back to the news.ycombinator.com item link
    expect(out[1].url).toBe('https://news.ycombinator.com/item?id=44500981');
    expect(out[1].excerpt).toBeNull();
  });
});

describe('reddit adapter', () => {
  it('fetches the .rss endpoint with a browser UA and maps Atom entries', async () => {
    const fn = stubFetch(fixture('reddit-rss.xml'));
    const out = await adapters.reddit.fetchItems(makeSource('reddit', { subreddit: 'LocalLLaMA' }));
    expect(String(fn.mock.calls[0][0])).toBe('https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day&limit=25');
    const init = fn.mock.calls[0][1];
    expect((init?.headers as Record<string, string>)['User-Agent']).toContain('Mozilla/5.0');
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe(
      'https://www.reddit.com/r/LocalLLaMA/comments/1lwabc/qwen4_72b_beats_gpt5_on_my_local_rag_benchmark/',
    );
    expect(out[0].title).toBe('Qwen4-72B beats GPT-5 on my local RAG benchmark');
    expect(out[0].excerpt).toContain('Ran 500 questions against both.');
    expect(out[0].excerpt).not.toContain('<');
    expect(out[0].publishedAt).toEqual(new Date('2026-07-09T12:00:00+00:00'));
    // entry without content -> null excerpt
    expect(out[1].excerpt).toBeNull();
  });
});

describe('arxiv adapter', () => {
  it('maps Atom entries, collapsing whitespace in titles', async () => {
    const fn = stubFetch(fixture('arxiv.xml'));
    const out = await adapters.arxiv.fetchItems(
      makeSource('arxiv', { query: 'cat:cs.AI OR cat:cs.CL', maxResults: 40 }),
    );
    const calledUrl = String(fn.mock.calls[0][0]);
    expect(calledUrl).toContain('export.arxiv.org/api/query');
    expect(calledUrl).toContain('max_results=40');
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe('http://arxiv.org/abs/2607.04512v1');
    expect(out[0].title).toBe('Self-Correcting Code Agents via Execution-Grounded Reinforcement Learning');
    expect(out[0].excerpt).toContain('We introduce EGRL, an execution-grounded reinforcement learning recipe');
    expect(out[0].publishedAt).toEqual(new Date('2026-07-08T17:59:12Z'));
    expect(out[1].title).toBe('Benchmarking Text-to-Video Consistency with Story-Level Evaluation');
  });
});

describe('huggingface adapter', () => {
  it('maps trending models', async () => {
    const fn = stubFetch(fixture('hf-models.json'));
    const out = await adapters.huggingface.fetchItems(makeSource('huggingface', { kind: 'models' }));
    expect(String(fn.mock.calls[0][0])).toContain('huggingface.co/api/models');
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      url: 'https://huggingface.co/deepseek-ai/DeepSeek-V4',
      title: 'deepseek-ai/DeepSeek-V4',
      excerpt: null,
      publishedAt: new Date('2026-07-09T02:41:10.000Z'),
    });
    expect(out[1].url).toBe('https://huggingface.co/black-forest-labs/FLUX.2-dev');
  });

  it('maps daily papers', async () => {
    const fn = stubFetch(fixture('hf-papers.json'));
    const out = await adapters.huggingface.fetchItems(makeSource('huggingface', { kind: 'papers' }));
    expect(String(fn.mock.calls[0][0])).toContain('huggingface.co/api/daily_papers');
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe('https://huggingface.co/papers/2607.04512');
    expect(out[0].title).toBe('Self-Correcting Code Agents via Execution-Grounded Reinforcement Learning');
    expect(out[0].excerpt).toContain('execution-grounded reinforcement learning recipe');
    expect(out[0].publishedAt).toEqual(new Date('2026-07-09T01:00:00.000Z'));
  });
});

describe('github adapter', () => {
  it('scrapes trending repos from article blocks', async () => {
    const fn = stubFetch(fixture('github-trending.html'));
    const out = await adapters.github.fetchItems(makeSource('github', {}));
    expect(String(fn.mock.calls[0][0])).toBe('https://github.com/trending?since=daily');
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      url: 'https://github.com/karpathy/nanochat',
      title: 'karpathy/nanochat',
      excerpt: 'The minimal, hackable full-stack ChatGPT clone & training pipeline.',
      publishedAt: null,
    });
    expect(out[1].title).toBe('browser-use/browser-use');
    expect(out[1].excerpt).toBe('Make websites accessible for AI agents.');
    // third repo has no description <p>
    expect(out[2].title).toBe('MiniMax-AI/MiniMax-M2');
    expect(out[2].excerpt).toBeNull();
  });

  it('scopes the url by language when configured', async () => {
    const fn = stubFetch(fixture('github-trending.html'));
    await adapters.github.fetchItems(makeSource('github', { language: 'typescript' }));
    expect(String(fn.mock.calls[0][0])).toBe('https://github.com/trending/typescript?since=daily');
  });

  it('throws on unrecognizable HTML so the health panel sees it', async () => {
    stubFetch('<html><body><h1>Rate limit exceeded</h1></body></html>');
    await expect(adapters.github.fetchItems(makeSource('github', {}))).rejects.toThrow(/layout changed/);
  });

  it('throws on fetch failure (after retries) so the health panel sees it', { timeout: 15000 }, async () => {
    stubFetch('nope', 429);
    await expect(adapters.github.fetchItems(makeSource('github', {}))).rejects.toThrow(/429/);
  });
});

describe('brave adapter', () => {
  beforeEach(() => {
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps news results, joining extra_snippets into the excerpt', async () => {
    const fn = stubFetch(fixture('brave-news.json'));
    const out = await adapters.brave.fetchItems(
      makeSource('brave', { query: 'AI coding assistant OR code model' }),
    );
    const calledUrl = String(fn.mock.calls[0][0]);
    expect(calledUrl).toContain('api.search.brave.com/res/v1/news/search');
    expect(calledUrl).toContain('q=AI+coding+assistant+OR+code+model');
    expect(calledUrl).toContain('freshness=pd');
    const init = fn.mock.calls[0][1];
    expect((init?.headers as Record<string, string>)['X-Subscription-Token']).toBe('test-brave-key');
    expect(out).toHaveLength(2); // result without a title is skipped
    expect(out[0]).toEqual({
      url: 'https://techcrunch.com/2026/08/12/openai-gpt-5-4-agentic-coding/',
      title: 'OpenAI ships GPT-5.4 with a persistent coding agent',
      excerpt:
        'The new model keeps a coding agent running across sessions. — Analysts call it the biggest capability jump since GPT-5.',
      publishedAt: new Date('2026-08-12T15:04:05'),
    });
    // no page_age/age -> null publishedAt
    expect(out[1].url).toBe('https://www.theverge.com/2026/8/12/cursor-raise');
    expect(out[1].publishedAt).toBeNull();
  });

  it('always fetches when called — poll cadence is owned by runIngest now', async () => {
    const fn = stubFetch(fixture('brave-news.json'));
    const fresh = { ...makeSource('brave', { query: 'AI' }), lastFetchedAt: new Date() };
    expect((await adapters.brave.fetchItems(fresh)).length).toBeGreaterThan(0);
    expect(fn).toHaveBeenCalled();
  });

  it('throws without BRAVE_API_KEY so runIngest records the failure', async () => {
    vi.stubEnv('BRAVE_API_KEY', '');
    await expect(adapters.brave.fetchItems(makeSource('brave', { query: 'AI' }))).rejects.toThrow(
      /BRAVE_API_KEY/,
    );
  });
});

describe('exa adapter', () => {
  beforeEach(() => {
    vi.stubEnv('EXA_API_KEY', 'test-exa-key');
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses Exa when it succeeds — never calls Brave', async () => {
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('api.exa.ai')) return new Response(fixture('exa-search.json'), { status: 200 });
      throw new Error('Brave should not have been called');
    });
    vi.stubGlobal('fetch', fn);

    const out = await adapters.exa.fetchItems(makeSource('exa', { query: 'AI coding assistant' }));
    expect(out).toHaveLength(2);
    expect(out[0]!.title).toContain('GPT-5.4');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('falls back to Brave with the same query when Exa errors', async () => {
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('api.exa.ai')) return new Response('forbidden', { status: 403 });
      if (String(input).includes('api.search.brave.com')) return new Response(fixture('brave-news.json'), { status: 200 });
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal('fetch', fn);

    const out = await adapters.exa.fetchItems(makeSource('exa', { query: 'AI coding assistant OR code model' }));
    expect(out).toHaveLength(2);
    expect(out[0]!.title).toContain('GPT-5.4');

    const braveUrl = String(fn.mock.calls[1]![0]);
    expect(braveUrl).toContain('q=AI+coding+assistant+OR+code+model');
  });

  it('throws Exa\'s error (not Brave\'s) when both fail', async () => {
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('api.exa.ai')) return new Response('exa down', { status: 403 });
      return new Response('brave also down', { status: 403 });
    });
    vi.stubGlobal('fetch', fn);

    await expect(adapters.exa.fetchItems(makeSource('exa', { query: 'AI' }))).rejects.toThrow(/exa down|HTTP 403/);
  });

  it('throws without config.query so runIngest records the failure', async () => {
    await expect(adapters.exa.fetchItems(makeSource('exa', {}))).rejects.toThrow(/missing config\.query/);
  });
});

describe('runIngest', () => {
  beforeEach(() => {
    useTestDb();
  });

  function seedSources() {
    getDb()
      .insert(sources)
      .values([
        { type: 'rss', name: 'Good RSS', config: JSON.stringify({ url: 'https://good.example.com/feed.xml' }) },
        { type: 'hn', name: 'HN AI', config: JSON.stringify({ query: 'AI', minPoints: 50 }) },
        { type: 'rss', name: 'Bad RSS', config: JSON.stringify({ url: 'https://bad.example.com/feed.xml' }) },
        { type: 'reddit', name: 'Disabled Sub', config: JSON.stringify({ subreddit: 'nope' }), enabled: false },
      ])
      .run();
  }

  function stubRoutedFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('https://good.example.com/')) return new Response(fixture('rss2.xml'), { status: 200 });
        if (url.includes('hn.algolia.com')) return new Response(fixture('hn.json'), { status: 200 });
        return new Response('boom', { status: 500 });
      }),
    );
  }

  it('inserts new items, dedups on rerun, and tracks per-source health', { timeout: 20000 }, async () => {
    seedSources();
    stubRoutedFetch();
    const db = getDb();

    // first run: 3 rss items + 3 hn hits inserted; bad source fails
    const first = await runIngest();
    expect(first).toEqual({ sourcesOk: 2, sourcesFailed: 1, sourcesSkipped: 0, newItems: 6 });

    const allItems = db.select().from(items).all();
    expect(allItems).toHaveLength(6);
    const gpt = allItems.find((i) => i.url === 'https://openai.com/index/introducing-gpt-5-3/');
    expect(gpt).toBeDefined();
    expect(gpt!.title).toBe('Introducing GPT-5.3');
    expect(gpt!.excerpt).toContain('Our most capable model yet');
    expect(gpt!.publishedAt).toEqual(new Date('2026-07-08T16:00:00Z'));
    expect(gpt!.fetchedAt).toBeInstanceOf(Date);

    const good = db.select().from(sources).where(eq(sources.name, 'Good RSS')).get()!;
    expect(good.consecutiveFailures).toBe(0);
    expect(good.lastStatus).toMatch(/^ok/);
    expect(good.lastFetchedAt).toBeInstanceOf(Date);

    const bad = db.select().from(sources).where(eq(sources.name, 'Bad RSS')).get()!;
    expect(bad.consecutiveFailures).toBe(1);
    expect(bad.lastStatus).toMatch(/^error/);

    // disabled source is never fetched
    const disabled = db.select().from(sources).where(eq(sources.name, 'Disabled Sub')).get()!;
    expect(disabled.lastFetchedAt).toBeNull();
    expect(disabled.lastStatus).toBeNull();

    // second run: sources aged past their cadence → refetch; everything dedups on unique url
    db.update(sources).set({ lastFetchedAt: new Date(Date.now() - 36e5) }).run();
    const second = await runIngest();
    expect(second).toEqual({ sourcesOk: 2, sourcesFailed: 1, sourcesSkipped: 0, newItems: 0 });
    expect(db.select().from(items).all()).toHaveLength(6);

    const badAgain = db.select().from(sources).where(eq(sources.name, 'Bad RSS')).get()!;
    expect(badAgain.consecutiveFailures).toBe(2);

    const goodAgain = db.select().from(sources).where(eq(sources.name, 'Good RSS')).get()!;
    expect(goodAgain.consecutiveFailures).toBe(0);
    expect(goodAgain.lastStatus).toMatch(/0 new/);
  });

  it('skips sources inside their poll cadence without stamping them', async () => {
    seedSources();
    const db = getDb();
    // freshly fetched an instant ago — nothing is due
    db.update(sources).set({ lastFetchedAt: new Date(), lastStatus: 'ok (previous run)' }).run();

    const res = await runIngest();
    expect(res).toEqual({ sourcesOk: 0, sourcesFailed: 0, sourcesSkipped: 3, newItems: 0 });

    // skipped sources are NOT re-stamped — this is what keeps throttled sources
    // (Brave et al) actually fetching again once their cadence elapses
    const good = db.select().from(sources).where(eq(sources.name, 'Good RSS')).get()!;
    expect(good.lastStatus).toBe('ok (previous run)');
  });

  it('honors per-source pollMinutes: hot sources re-poll while slow ones skip', async () => {
    seedSources();
    stubRoutedFetch();
    const db = getDb();
    // all sources fetched 20 min ago
    db.update(sources).set({ lastFetchedAt: new Date(Date.now() - 20 * 60e3) }).run();
    // Good RSS polls every 15 min → due; HN + Bad RSS default to 30 → not due
    db.update(sources)
      .set({ config: JSON.stringify({ url: 'https://good.example.com/feed.xml', pollMinutes: 15 }) })
      .where(eq(sources.name, 'Good RSS'))
      .run();

    const res = await runIngest();
    expect(res).toEqual({ sourcesOk: 1, sourcesFailed: 0, sourcesSkipped: 2, newItems: 3 });
  });

  it('backs off chronically failing sources beyond their cadence', async () => {
    seedSources();
    stubRoutedFetch();
    const db = getDb();
    // Good RSS: fetched 40 min ago but failed 5× straight → cadence 30 × 2³ = 240 min → not due
    db.update(sources)
      .set({ lastFetchedAt: new Date(Date.now() - 40 * 60e3), consecutiveFailures: 5 })
      .where(eq(sources.name, 'Good RSS'))
      .run();
    // HN: healthy, fetched 40 min ago → due (30 min default)
    db.update(sources).set({ lastFetchedAt: new Date(Date.now() - 40 * 60e3) }).where(eq(sources.name, 'HN AI')).run();
    // Bad RSS: fetched just now → not due
    db.update(sources).set({ lastFetchedAt: new Date() }).where(eq(sources.name, 'Bad RSS')).run();

    const res = await runIngest();
    expect(res).toEqual({ sourcesOk: 1, sourcesFailed: 0, sourcesSkipped: 2, newItems: 3 });
  });
});
