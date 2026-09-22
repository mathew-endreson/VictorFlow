import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Walk up from `start` to the directory holding pnpm-workspace.yaml (the monorepo root). */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

/** Load <repo>/.env into process.env (existing variables win) and return the repo root. */
export function loadEnv(): string {
  const root = findRepoRoot();
  dotenv.config({ path: path.join(root, '.env') });
  return root;
}
