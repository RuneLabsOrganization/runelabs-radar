import { describe, expect, it } from 'vitest';
import {
  browserLoopbackRedirect,
  isLoopbackRedirectUri,
  oauthCompleteLanding,
  scheduleLoopbackHandoff,
} from '@/lib/oauth-loopback';

describe('browserLoopbackRedirect', () => {
  it('detects loopback redirect URIs', () => {
    expect(isLoopbackRedirectUri('http://127.0.0.1:60653/callback')).toBe(true);
    expect(isLoopbackRedirectUri('http://localhost:9877/callback')).toBe(true);
    expect(isLoopbackRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(false);
  });

  it('rewrites 127.0.0.1 loopback to localhost for browser navigation', () => {
    expect(browserLoopbackRedirect('http://127.0.0.1:60653/callback')).toBe('http://localhost:60653/callback');
    expect(browserLoopbackRedirect('http://127.0.0.1:60653/callback?code=abc&state=x')).toBe(
      'http://localhost:60653/callback?code=abc&state=x',
    );
  });

  it('rewrites IPv6 loopback to localhost', () => {
    expect(browserLoopbackRedirect('http://[::1]:8787/callback')).toBe('http://localhost:8787/callback');
  });

  it('leaves localhost and public https URIs unchanged', () => {
    expect(browserLoopbackRedirect('http://localhost:9877/callback')).toBe('http://localhost:9877/callback');
    expect(browserLoopbackRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(
      'https://claude.ai/api/mcp/auth_callback',
    );
  });
});

describe('oauthCompleteLanding', () => {
  it('builds /oauth/complete on the public origin, not a Docker request URL', () => {
    const callback = 'http://127.0.0.1:8787/callback?code=gTsG7k6fYixtVmWv&state=abc';
    const landing = oauthCompleteLanding(callback, 'https://radar.runelabs.org');
    const parsed = new URL(landing);
    expect(parsed.origin).toBe('https://radar.runelabs.org');
    expect(parsed.pathname).toBe('/oauth/complete');
    expect(parsed.searchParams.get('to')).toBe(
      'http://localhost:8787/callback?code=gTsG7k6fYixtVmWv&state=abc',
    );
    expect(landing).not.toContain('c1949c020530');
  });

  it('ignores the incoming request origin when it is a container hostname', () => {
    const callback = 'http://localhost:8787/callback?code=x';
    const fromReqUrl = new URL(
      `/oauth/complete?to=${encodeURIComponent(callback)}`,
      'https://c1949c020530:3000/api/oauth/authorize',
    ).toString();
    expect(new URL(fromReqUrl).hostname).toBe('c1949c020530');
    const landing = oauthCompleteLanding(callback, 'https://radar.runelabs.org/');
    expect(new URL(landing).hostname).toBe('radar.runelabs.org');
    expect(landing.startsWith('https://radar.runelabs.org/oauth/complete?to=')).toBe(true);
  });

  it('does not wrap non-loopback redirect URIs', () => {
    const cb = 'https://claude.ai/api/mcp/auth_callback?code=abc';
    expect(oauthCompleteLanding(cb, 'https://radar.runelabs.org')).toBe(cb);
  });
});

describe('scheduleLoopbackHandoff', () => {
  it('navigates to the callback URL', async () => {
    const hits: string[] = [];
    const cancel = scheduleLoopbackHandoff(
      'http://localhost:8787/callback?code=x',
      (url) => hits.push(url),
      0,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(hits).toEqual(['http://localhost:8787/callback?code=x']);
    cancel();
  });

  it('cancel prevents a pending handoff', async () => {
    const hits: string[] = [];
    const cancel = scheduleLoopbackHandoff('http://localhost:1/x', (url) => hits.push(url), 40);
    cancel();
    await new Promise((r) => setTimeout(r, 60));
    expect(hits).toEqual([]);
  });
});
