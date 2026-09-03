import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapters } from '@/lib/ingest/adapters';
import {
  _setSleepForTests,
  fetchText,
  fetchWithTimeout,
  parseResetSeconds,
  UnsafeUrlError,
} from '@/lib/ingest/adapters/shared';
import type { Source } from '@/lib/ingest/types';
import { safePublicHttpUrl } from '@/lib/safe-url';

function makeSource(config: Record<string, unknown>): Source {
  return {
    id: 1,
    type: 'rss',
    name: 'test-rss',
    config: JSON.stringify(config),
    domainHints: '[]',
    enabled: true,
    lastFetchedAt: null,
    lastStatus: null,
    consecutiveFailures: 0,
    consecutiveEmpty: 0,
  };
}

beforeEach(() => {
  _setSleepForTests(() => Promise.resolve());
});

afterEach(() => {
  vi.unstubAllGlobals();
  _setSleepForTests(null);
});

describe('safePublicHttpUrl (I6)', () => {
  it('rejects loopback, private and link-local hosts', () => {
    const blocked = [
      'http://127.0.0.1/',
      'http://127.1/', // shorthand — URL-normalized to 127.0.0.1
      'http://0x7f000001/', // hex — normalized too
      'http://localhost:8080/admin',
      'http://backend.localhost/',
      'http://10.0.0.5/internal',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data', // cloud metadata
      'http://100.64.0.1/', // CGNAT
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[::]/',
      'http://[::ffff:127.0.0.1]/', // IPv4-mapped loopback
      'http://[fe80::1]/', // link-local
      'http://[fd00::1]/', // unique-local
    ];
    for (const u of blocked) {
      expect(safePublicHttpUrl(u), u).toBeNull();
    }
  });

  it('rejects non-http(s) schemes and unparseable input', () => {
    expect(safePublicHttpUrl('ftp://example.com/feed')).toBeNull();
    expect(safePublicHttpUrl('file:///etc/passwd')).toBeNull();
    expect(safePublicHttpUrl('gopher://example.com/')).toBeNull();
    expect(safePublicHttpUrl('not a url')).toBeNull();
    expect(safePublicHttpUrl('')).toBeNull();
    expect(safePublicHttpUrl(null)).toBeNull();
  });

  it('allows public http(s) hosts', () => {
    expect(safePublicHttpUrl('https://example.com/feed.xml')).toBe('https://example.com/feed.xml');
    expect(safePublicHttpUrl('http://feeds.arxiv.org/rss/cs.AI')).toBe('http://feeds.arxiv.org/rss/cs.AI');
    expect(safePublicHttpUrl('https://8.8.8.8/dns')).toBe('https://8.8.8.8/dns');
    expect(safePublicHttpUrl('http://172.32.0.1/')).toBe('http://172.32.0.1/'); // outside /12
  });
});

describe('rss adapter config-time SSRF guard (I6)', () => {
  it('rejects a private-host config.url before any fetch happens', async () => {
    const fn = vi.fn(async () => new Response('x', { status: 200 }));
    vi.stubGlobal('fetch', fn);
    await expect(
      adapters.rss.fetchItems(makeSource({ url: 'http://169.254.169.254/latest/meta-data' })),
    ).rejects.toThrow(/unsafe config\.url/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) config.url', async () => {
    await expect(adapters.rss.fetchItems(makeSource({ url: 'file:///etc/passwd' }))).rejects.toThrow(
      /unsafe config\.url/,
    );
  });
});

describe('fetchWithTimeout redirect guard (I6)', () => {
  function redirectTo(location: string, status = 302): Response {
    return new Response(null, { status, headers: { location } });
  }

  it('blocks a redirect to 169.254.169.254', async () => {
    const fn = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(redirectTo('http://169.254.169.254/latest/meta-data'))
      .mockResolvedValueOnce(new Response('metadata', { status: 200 }));
    vi.stubGlobal('fetch', fn);

    await expect(fetchText('https://feeds.example.com/rss')).rejects.toThrow(UnsafeUrlError);
    // the redirect target was never requested
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect to 127.0.0.1', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => redirectTo('http://127.0.0.1:8080/admin', 301)),
    );
    await expect(fetchText('https://feeds.example.com/rss')).rejects.toThrow(/blocked unsafe fetch URL/);
  });

  it('follows a redirect to a public host (relative Location resolves)', async () => {
    const fn = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(redirectTo('/feed.xml', 301))
      .mockResolvedValueOnce(new Response('feed body', { status: 200 }));
    vi.stubGlobal('fetch', fn);

    await expect(fetchText('https://feeds.example.com/rss')).resolves.toBe('feed body');
    expect(String(fn.mock.calls[1][0])).toBe('https://feeds.example.com/feed.xml');
    // redirects are fetched manually so each hop can be validated
    expect(fn.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('gives up after too many redirects', async () => {
    const fn = vi.fn(async () => redirectTo('https://feeds.example.com/loop', 302));
    vi.stubGlobal('fetch', fn);
    await expect(fetchText('https://feeds.example.com/loop')).rejects.toThrow(/too many redirects/);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('rewrites POST to GET across a 303 and drops the body', async () => {
    const fn = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(redirectTo('https://api.example.com/v2', 303))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fn);

    const res = await fetchWithTimeout('https://api.example.com/v1', { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    expect(fn.mock.calls[1][1]?.method).toBe('GET');
    expect(fn.mock.calls[1][1]?.body).toBeNull();
  });

  it('rejects an unsafe initial URL without fetching', async () => {
    const fn = vi.fn(async () => new Response('x', { status: 200 }));
    vi.stubGlobal('fetch', fn);
    await expect(fetchText('http://192.168.0.1/feed')).rejects.toThrow(UnsafeUrlError);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('parseResetSeconds epoch handling (I9)', () => {
  function resWith(header: string, value: string): Response {
    return new Response(null, { status: 429, headers: { [header]: value } });
  }

  it('converts an epoch-seconds x-ratelimit-reset into a delta from now', () => {
    const epoch = Math.floor(Date.now() / 1000) + 90;
    const out = parseResetSeconds(resWith('x-ratelimit-reset', String(epoch)));
    expect(out).not.toBeNull();
    expect(Math.abs(out! - 90)).toBeLessThanOrEqual(5);
  });

  it('clamps a past epoch to 0 instead of going negative', () => {
    const epoch = Math.floor(Date.now() / 1000) - 3600;
    expect(parseResetSeconds(resWith('x-ratelimit-reset', String(epoch)))).toBe(0);
  });

  it('leaves delta-seconds headers unchanged', () => {
    expect(parseResetSeconds(resWith('retry-after', '120'))).toBe(120);
    expect(parseResetSeconds(resWith('x-ratelimit-reset', '1, 522166'))).toBe(522166);
  });
});

describe('fetchWithTimeout retried statuses release the body (I10)', () => {
  it('cancels the 503 body before retrying, then succeeds', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('busy'));
        controller.close();
      },
    });
    const unavailable = new Response(stream, { status: 503 });
    const cancelSpy = vi.spyOn(unavailable.body!, 'cancel');
    const fn = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(new Response('recovered', { status: 200 }));
    vi.stubGlobal('fetch', fn);

    await expect(fetchText('https://example.com/feed')).resolves.toBe('recovered');
    expect(cancelSpy).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
