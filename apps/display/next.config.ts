import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // NEXT_DIST_DIR lets a second instance (e.g. a UI test run) live beside a running dev server without sharing its build folder.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The server installer ships a self-contained server.js. apps/server-host/scripts/stage.mjs builds it with
  // VF_NEXT_STANDALONE=1 inside a `pnpm deploy` copy of this app (flat node_modules, only this app's dependencies, so
  // exactly one React), which is why everything is traced from this folder. Off for `pnpm dev`.
  ...(process.env.VF_NEXT_STANDALONE === '1' ? { output: 'standalone' as const, outputFileTracingRoot: path.resolve(__dirname) } : {}),
  // A screen's pairing token will be in its URL (/staff/<token>, /clients/<token>): never leak it, cache it or index it.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default config;
