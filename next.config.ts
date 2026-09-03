import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import { REDIRECTS } from './src/lib/urls';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  async redirects() {
    return REDIRECTS;
  },
  async headers() {
    return [
      // Only /embed/* is meant to be framed; everything else gets clickjacking
      // and sniffing protection. Full CSP is a deliberate follow-up: the inline
      // theme-boot scripts need nonces/hashes wired through layout first.
      {
        source: '/((?!embed/).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/embed/:path*',
        headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
});
