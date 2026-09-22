import { defineConfig } from 'tsup';

// CJS only (NestJS server + tsx CLI). Migrations stay as plain .sql files next to dist/ and are read at runtime.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  shims: true,
  // Keep native / heavy deps external — they are real dependencies of this package.
  external: ['argon2', 'pg', 'kysely', 'dotenv', '@victorflow/types'],
});
