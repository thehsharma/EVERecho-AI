import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages are consumed as TypeScript source (DECISION_LOG D-002).
  transpilePackages: ['@everecho/contracts'],
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'x-content-type-options', value: 'nosniff' },
          { key: 'x-frame-options', value: 'DENY' },
          { key: 'referrer-policy', value: 'no-referrer' },
          { key: 'permissions-policy', value: 'camera=(), geolocation=(), interest-cohort=()' },
        ],
      },
    ];
  },
};

export default config;
