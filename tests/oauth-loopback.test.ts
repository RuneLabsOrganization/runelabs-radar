import { describe, expect, it } from 'vitest';
import { browserLoopbackRedirect } from '@/lib/oauth-loopback';

describe('browserLoopbackRedirect', () => {
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
