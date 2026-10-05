// node apps/server-host/dist/licence-key.mjs check --stage <stage>
// node apps/server-host/dist/licence-key.mjs swap  --stage <copy of the stage> --public-key <throwaway public.pem>
// Build-time only (CI and testing); never part of the installed program. The committed key and the placeholder test
// come from this checkout's built @victorflow/crypto.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VfError } from './errors';
import { findRepoRoot } from './layout';
import { checkReleaseKey, swapKeyInTestCopy } from './licence-key';

interface CryptoModule {
  LICENCE_PUBLIC_KEY: string;
  isPlaceholderLicenceKey(key: string): boolean;
  publicKeyLine(key: string): string;
}

function main(argv: string[]): string {
  const [command] = argv;
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    const v = i >= 0 ? argv[i + 1] : undefined;
    if (!v) throw new VfError('USAGE', `${name} is required`);
    return path.resolve(v);
  };
  const repo = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
  if (!repo) throw new VfError('LAYOUT', 'licence-key runs from the VictorFlow repository');
  const crypto = createRequire(path.join(repo, 'package.json'))(path.join(repo, 'packages', 'crypto', 'dist', 'index.js')) as CryptoModule;

  if (command === 'check') {
    const files = checkReleaseKey(opt('--stage'), crypto.LICENCE_PUBLIC_KEY, crypto.isPlaceholderLicenceKey);
    return `the release stage carries BluxTech's licence public key (${files.length} file(s))`;
  }
  if (command === 'swap') {
    const testKey = crypto.publicKeyLine(readFileSync(opt('--public-key'), 'utf8'));
    const files = swapKeyInTestCopy(opt('--stage'), crypto.LICENCE_PUBLIC_KEY, testKey);
    return `test copy: throwaway licence key swapped in ${files.length} file(s)`;
  }
  throw new VfError('USAGE', 'usage: licence-key check --stage <stage> | swap --stage <test copy> --public-key <public.pem>');
}

try {
  console.log(`[licence-key] ${main(process.argv.slice(2))}`);
} catch (e) {
  console.error(`[licence-key] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
