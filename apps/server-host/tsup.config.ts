import { defineConfig } from 'tsup';

// One self-contained ESM file with no npm dependencies: it is copied next to the bundled node.exe as vf-server.mjs.
// `pg` and `@victorflow/db` are loaded at runtime from the deployed server's own node_modules (see db.ts).
export default defineConfig({
  entry: { 'vf-server': 'src/cli.ts' },
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: false,
  dts: false,
});
