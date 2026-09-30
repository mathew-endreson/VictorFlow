// Claude Code Stop hook: runs `pnpm typecheck` and blocks the turn from ending while it fails.
// Exit 0 = let Claude stop. Exit 2 = block; stderr is fed back to Claude as the reason.
// The full test suite is deliberately NOT run here (that's `pnpm verify`).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAIL_LINES = 80;

const r = spawnSync('pnpm typecheck', { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;

if (r.status === 0) process.exit(0);

// Windows Smart App Control intermittently blocks turbo.exe on this machine. That isn't a type error and
// Claude can't fix it, so blocking would loop forever — warn the user instead of blocking.
if (/Application Control policy has blocked this file/i.test(output)) {
  process.stdout.write(
    JSON.stringify({
      systemMessage:
        'Stop hook: `pnpm typecheck` could not run — Windows Smart App Control blocked a binary (likely turbo.exe). Not treated as a type error; retry `pnpm typecheck` manually.',
    }),
  );
  process.exit(0);
}

const tail = output.trimEnd().split(/\r?\n/).slice(-TAIL_LINES).join('\n');
process.stderr.write(
  `\`pnpm typecheck\` is failing (exit ${r.status ?? r.error?.message}). Fix the type errors before finishing.\n` +
    `Last ${TAIL_LINES} lines of output:\n${tail}\n`,
);
process.exit(2);
