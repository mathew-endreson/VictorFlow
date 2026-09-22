import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // NEXT_DIST_DIR lets a second instance (e.g. a UI test run) live beside a running dev server without sharing its build folder.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The tracking token is in the URL: never let it leak through the Referer header, never cache the page, never index it.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default config;
