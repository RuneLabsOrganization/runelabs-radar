import { describe, expect, it } from 'vitest';
import { redirectDestination } from '@/lib/urls';

describe('redirectDestination (OAuth consent screen)', () => {
  it('surfaces the host of an https redirect with no warning needed', () => {
    expect(redirectDestination('https://claude.ai/api/mcp-auth-callback?x=1')).toEqual({
      host: 'claude.ai',
      scheme: 'https',
      https: true,
    });
  });

  it('keeps a non-default port in the host', () => {
    const d = redirectDestination('https://example.com:8443/cb');
    expect(d).toEqual({ host: 'example.com:8443', scheme: 'https', https: true });
  });

  it('flags loopback http redirects as not https', () => {
    const d = redirectDestination('http://127.0.0.1:7777/callback');
    expect(d).toEqual({ host: '127.0.0.1:7777', scheme: 'http', https: false });
  });

  it('parses custom schemes registered by desktop MCP clients', () => {
    const d = redirectDestination('cursor://mcp-callback');
    expect(d).toEqual({ host: 'mcp-callback', scheme: 'cursor', https: false });
  });

  it('returns an empty host for opaque custom-scheme URIs', () => {
    const d = redirectDestination('myapp:/cb');
    expect(d).toEqual({ host: '', scheme: 'myapp', https: false });
  });

  it('normalizes upper-case schemes and hosts', () => {
    const d = redirectDestination('HTTPS://Example.COM/cb');
    expect(d).toEqual({ host: 'example.com', scheme: 'https', https: true });
  });

  it('returns null for unparseable input', () => {
    expect(redirectDestination('not a url')).toBeNull();
    expect(redirectDestination('')).toBeNull();
  });
});
