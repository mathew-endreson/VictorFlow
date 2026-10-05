import { defineConfig } from 'tsup';

// One self-contained ESM file with no npm dependencies: it is copied next to the bundled node.exe as vf-server.mjs.
// `pg` and `@victorflow/db` are loaded at runtime from the deployed server's own node_modules (see db.ts).
// licence-key.mjs is a build-time tool (CI: check the release key, swap a test key into a copy) and is not staged.
export default defineConfig({
  entry: { 'vf-server': 'src/cli.ts', 'licence-key': 'src/licence-key-cli.ts' },
  // each file stands alone: no shared chunk that vf-server.mjs would need next to it
  splitting: false,
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: false,
  dts: false,
});
