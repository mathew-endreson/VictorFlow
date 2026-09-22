import { defineConfig } from 'tsup';

// Dual CJS/ESM: NestJS (CJS) and Vite/Next/Metro (ESM) all consume this package.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
