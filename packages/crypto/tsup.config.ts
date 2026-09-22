import { defineConfig } from 'tsup';

// Node-only, consumed by the NestJS server (CJS).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
});
