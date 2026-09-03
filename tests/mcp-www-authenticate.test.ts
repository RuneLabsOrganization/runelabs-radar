import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertPublicUrl, resourceMetadataOrigin, wwwAuthenticate } from '../mcp/lib/auth';

/**
 * G4: the RFC 9728 challenge must never build the resource_metadata URL from
 * an unvalidated Host header. MCP_PUBLIC_URL wins; the dev fallback trusts
 * loopback Hosts only; anything else falls back to the configured site URL.
 */

const ENV_KEYS = ['MCP_PUBLIC_URL', 'SITE_URL', 'MCP_AUTH_REQUIRED'] as const;
type EnvKey = (typeof ENV_KEYS)[number];
let saved: Record<EnvKey, string | undefined>;

beforeEach(() => {
  saved = {} as Record<EnvKey, string | undefined>;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.MCP_PUBLIC_URL;
  delete process.env.MCP_AUTH_REQUIRED;
  process.env.SITE_URL = 'http://site.test';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllEnvs();
});

function metadataUrl(header: string): string {
  const m = /resource_metadata="([^"]+)"/.exec(header);
  expect(m).not.toBeNull();
  return m![1]!;
}

describe('wwwAuthenticate / resourceMetadataOrigin', () => {
  it('never reflects an injected Host into the metadata URL', () => {
    const header = wwwAuthenticate({ headers: { host: 'evil.com' } });
    expect(metadataUrl(header)).toBe('http://site.test/.well-known/oauth-protected-resource');
    expect(header).not.toContain('evil.com');
  });

  it('trusts a loopback Host in dev (direct self-host hits)', () => {
    expect(metadataUrl(wwwAuthenticate({ headers: { host: 'localhost:3122' } }))).toBe(
      'http://localhost:3122/.well-known/oauth-protected-resource',
    );
    expect(metadataUrl(wwwAuthenticate({ headers: { host: '127.0.0.1:3122' } }))).toBe(
      'http://127.0.0.1:3122/.well-known/oauth-protected-resource',
    );
    expect(metadataUrl(wwwAuthenticate({ headers: { host: '[::1]:3122' } }))).toBe(
      'http://[::1]:3122/.well-known/oauth-protected-resource',
    );
  });

  it('honors x-forwarded-proto only for loopback Hosts', () => {
    const loopback = resourceMetadataOrigin({ headers: { host: 'localhost:3122', 'x-forwarded-proto': 'https' } });
    expect(loopback).toBe('https://localhost:3122');
    const injected = resourceMetadataOrigin({ headers: { host: 'evil.com', 'x-forwarded-proto': 'https' } });
    expect(injected).toBe('http://site.test');
  });

  it('rejects lookalike loopback Hosts', () => {
    expect(resourceMetadataOrigin({ headers: { host: 'localhost.evil.com' } })).toBe('http://site.test');
  });

  it('falls back to the site URL on a malformed Host instead of throwing', () => {
    expect(resourceMetadataOrigin({ headers: { host: 'http://[' } })).toBe('http://site.test');
  });

  it('MCP_PUBLIC_URL always wins, whatever the Host says', () => {
    process.env.MCP_PUBLIC_URL = 'https://radar.example.com/mcp';
    expect(resourceMetadataOrigin({ headers: { host: 'evil.com' } })).toBe('https://radar.example.com');
    expect(resourceMetadataOrigin({ headers: { host: 'localhost:3122' } })).toBe('https://radar.example.com');
  });
});

describe('assertPublicUrl (fail fast at startup)', () => {
  it('throws in production when MCP_PUBLIC_URL is missing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertPublicUrl()).toThrow(/MCP_PUBLIC_URL/);
  });

  it('passes in production when MCP_PUBLIC_URL is set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.MCP_PUBLIC_URL = 'https://radar.example.com/mcp';
    expect(() => assertPublicUrl()).not.toThrow();
  });

  it('passes in dev even with auth required — the loopback-validated Host fallback applies', () => {
    process.env.MCP_AUTH_REQUIRED = 'true';
    expect(() => assertPublicUrl()).not.toThrow();
  });

  it('passes in dev anonymous mode without MCP_PUBLIC_URL', () => {
    expect(() => assertPublicUrl()).not.toThrow();
  });
});
