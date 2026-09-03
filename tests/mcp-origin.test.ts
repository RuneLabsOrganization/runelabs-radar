import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '../mcp/lib/origin';

/**
 * DNS-rebinding guard (MCP spec: servers MUST validate Origin). The HTTP
 * layer in mcp/server.ts rejects anonymous-mode requests whose Origin fails
 * this predicate with 403 before the transport is touched; the predicate is
 * extracted here for direct testing.
 */
describe('isAllowedOrigin', () => {
  it('allows requests with no Origin header (non-browser MCP clients)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('')).toBe(true);
  });

  it('allows loopback origins on any port', () => {
    expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3122')).toBe(true);
    expect(isAllowedOrigin('http://[::1]:3122')).toBe(true);
    expect(isAllowedOrigin('https://localhost')).toBe(true);
  });

  it('rejects drive-by origins from the public web', () => {
    expect(isAllowedOrigin('http://evil.com')).toBe(false);
    expect(isAllowedOrigin('https://evil.com:443')).toBe(false);
  });

  it('rejects lookalike hostnames that merely contain a loopback name', () => {
    expect(isAllowedOrigin('http://localhost.evil.com')).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1.evil.com')).toBe(false);
  });

  it('rejects malformed Origin values instead of failing open', () => {
    expect(isAllowedOrigin('not a url')).toBe(false);
    expect(isAllowedOrigin('://broken')).toBe(false);
  });

  it('allows the configured public origin when MCP_PUBLIC_URL is set', () => {
    const pub = 'https://radar.example.com/mcp';
    expect(isAllowedOrigin('https://radar.example.com', pub)).toBe(true);
    expect(isAllowedOrigin('http://evil.com', pub)).toBe(false);
    // loopback stays allowed even with a public URL configured (local agents)
    expect(isAllowedOrigin('http://localhost:3122', pub)).toBe(true);
  });

  it('does not fail open when the configured public URL is unparseable', () => {
    expect(isAllowedOrigin('http://evil.com', 'not a url')).toBe(false);
  });
});
