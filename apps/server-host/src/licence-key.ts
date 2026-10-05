// The licence public key inside a staged installer payload (<stage>/app/server, where the API and its packages are):
//   check — the release stage carries the committed key, and that key is BluxTech's, not the placeholder
//   swap  — a COPY of the stage (marked as a test copy) gets a throwaway key, so CI can sign licences for its smoke test
// The release stage itself is never modified: swap refuses any folder without the test-copy marker.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VfError } from './errors';

export const TEST_COPY_MARKER = '.test-copy';
const SCRIPT = /\.(js|mjs|cjs)$/;
/** One line of base64 DER for an Ed25519 public key (what licence-public-key.ts holds). */
const KEY_LINE = /^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/;

/** The API's own code and its @victorflow packages: the only places the licence key can be. */
function scriptFiles(stage: string): string[] {
  const server = path.join(stage, 'app', 'server');
  if (!existsSync(server)) throw new VfError('LAYOUT', `${stage} is not a staged VictorFlow Server (no app\\server folder)`);
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (SCRIPT.test(name)) out.push(p);
    }
  };
  walk(path.join(server, 'dist'));
  walk(path.join(server, 'node_modules', '@victorflow'));
  return out;
}

const containing = (files: string[], text: string) => files.filter((f) => readFileSync(f, 'utf8').includes(text));

export const PLACEHOLDER_MESSAGE =
  'This release still has the placeholder licence public key. Run `licence-issuer keygen` on the offline BluxTech machine and put the printed line into packages/crypto/src/licence-public-key.ts.';

/** Before the release installer is built. Returns the files that carry the key. */
export function checkReleaseKey(stage: string, committedKey: string, isPlaceholder: (key: string) => boolean): string[] {
  if (isPlaceholder(committedKey)) throw new VfError('LICENCE_KEY', PLACEHOLDER_MESSAGE);
  const found = containing(scriptFiles(stage), committedKey);
  if (found.length === 0) throw new VfError('LICENCE_KEY', `The staged server in ${stage} does not carry the committed licence public key (built from another checkout, or swapped?)`);
  return found;
}

/** For the CI smoke test only: replaces the committed key by `testKey` in a marked copy of the stage. */
export function swapKeyInTestCopy(copy: string, committedKey: string, testKey: string): string[] {
  if (!existsSync(path.join(copy, TEST_COPY_MARKER))) {
    throw new VfError('LICENCE_KEY', `${copy} has no ${TEST_COPY_MARKER} marker: the key is only ever swapped in a copy of the stage, never in the release stage`);
  }
  if (!KEY_LINE.test(testKey)) throw new VfError('LICENCE_KEY', 'The test key must be one line of base64 (an Ed25519 public key, DER)');
  if (testKey === committedKey) throw new VfError('LICENCE_KEY', 'The test key is the committed key');
  const files = containing(scriptFiles(copy), committedKey);
  if (files.length === 0) throw new VfError('LICENCE_KEY', `No file in ${copy} carries the committed licence public key: nothing to swap`);
  for (const f of files) writeFileSync(f, readFileSync(f, 'utf8').split(committedKey).join(testKey));
  const left = containing(scriptFiles(copy), committedKey);
  if (left.length) throw new VfError('LICENCE_KEY', `The committed key is still in ${left.join(', ')}`);
  return files;
}
