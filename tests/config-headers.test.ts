import { describe, expect, it } from 'vitest';
import type { NextConfig } from 'next';
import nextConfig from '../next.config';

// The default export is nextConfig passed through withSentryConfig (next.config.ts).
const config: NextConfig = nextConfig;

describe('next.config security headers', () => {
  it('disables the X-Powered-By header', () => {
    expect(config.poweredByHeader).toBe(false);
  });

  it('sends clickjacking and sniffing protection outside /embed', async () => {
    const rules = await config.headers!();
    const main = rules.find((r) => r.source === '/((?!embed/).*)');
    expect(main).toBeDefined();
    const byKey = new Map(main!.headers.map((h) => [h.key, h.value]));
    expect(byKey.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff');
    expect(byKey.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('keeps /embed/* frameable while still sending nosniff', async () => {
    const rules = await config.headers!();
    const embed = rules.find((r) => r.source === '/embed/:path*');
    expect(embed).toBeDefined();
    const byKey = new Map(embed!.headers.map((h) => [h.key, h.value]));
    expect(byKey.has('X-Frame-Options')).toBe(false);
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
