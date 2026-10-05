import { defineConfig } from 'tsup';

// One self-contained file (the workspace packages and zod bundled in), so it can be copied to BluxTech's offline
// machine and run with a plain `node licence-issuer.mjs …`. Nothing in the repo depends on it, so it never ships.
export default defineConfig({
  entry: { 'licence-issuer': 'src/cli.ts' },
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  platform: 'node',
  target: 'node22',
  noExternal: [/.*/],
  // @victorflow/crypto is CommonJS: its require('node:crypto') needs a real require inside this ES module.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  clean: true,
  sourcemap: false,
  dts: false,
});
