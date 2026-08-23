import type { NextConfig } from 'next';
import { REDIRECTS } from './src/lib/urls';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  async redirects() {
    return REDIRECTS;
  },
};

export default nextConfig;
