import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkReleaseKey, PLACEHOLDER_MESSAGE, swapKeyInTestCopy, TEST_COPY_MARKER } from './licence-key';

const keyLine = () => generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const COMMITTED = keyLine();
const notPlaceholder = () => false;

/** A staged payload with the key where tsup puts it (@victorflow/crypto's dist) and a few files without it. */
function stage(key = COMMITTED, { marker = false } = {}) {
  const out = mkdtempSync(path.join(os.tmpdir(), 'vf-stage-'));
  const crypto = path.join(out, 'app', 'server', 'node_modules', '@victorflow', 'crypto', 'dist');
  mkdirSync(crypto, { recursive: true });
  writeFileSync(path.join(crypto, 'index.js'), `"use strict";\nvar LICENCE_PUBLIC_KEY = "${key}";\nexports.LICENCE_PUBLIC_KEY = LICENCE_PUBLIC_KEY;\n`);
  writeFileSync(path.join(crypto, 'index.js.map'), `{"sourcesContent":["${key}"]}`); // not code: left alone
  mkdirSync(path.join(out, 'app', 'server', 'dist'), { recursive: true });
  writeFileSync(path.join(out, 'app', 'server', 'dist', 'main.js'), 'require("./app.module");\n');
  if (marker) writeFileSync(path.join(out, TEST_COPY_MARKER), '');
  return out;
}

describe('licence-key check (before the release installer is built)', () => {
  it('passes when the release stage carries the committed key and it is not the placeholder', () => {
    expect(checkReleaseKey(stage(), COMMITTED, notPlaceholder)).toHaveLength(1);
  });

  it('FAILS while the committed key is the placeholder, with what to do', () => {
    expect(() => checkReleaseKey(stage(), COMMITTED, () => true)).toThrow(PLACEHOLDER_MESSAGE);
    expect(PLACEHOLDER_MESSAGE).toMatch(/licence-issuer keygen.*offline.*licence-public-key\.ts/);
  });

  it('fails when the stage does not carry the committed key (swapped, or built from another checkout)', () => {
    expect(() => checkReleaseKey(stage(keyLine()), COMMITTED, notPlaceholder)).toThrow(/does not carry the committed licence public key/);
    expect(() => checkReleaseKey(mkdtempSync(path.join(os.tmpdir(), 'vf-empty-')), COMMITTED, notPlaceholder)).toThrow(/not a staged VictorFlow Server/);
  });
});

describe('licence-key swap (CI test copy only)', () => {
  it('refuses a folder without the test-copy marker: the release stage is never modified', () => {
    const release = stage();
    expect(() => swapKeyInTestCopy(release, COMMITTED, keyLine())).toThrow(/never in the release stage/);
    expect(readFileSync(path.join(release, 'app', 'server', 'node_modules', '@victorflow', 'crypto', 'dist', 'index.js'), 'utf8')).toContain(COMMITTED);
  });

  it('replaces the key in the code of the copy, so the copy trusts the throwaway key and not the committed one', () => {
    const copy = stage(COMMITTED, { marker: true });
    const test = keyLine();
    expect(swapKeyInTestCopy(copy, COMMITTED, test)).toHaveLength(1);
    const code = readFileSync(path.join(copy, 'app', 'server', 'node_modules', '@victorflow', 'crypto', 'dist', 'index.js'), 'utf8');
    expect(code).toContain(test);
    expect(code).not.toContain(COMMITTED);
    expect(() => checkReleaseKey(copy, COMMITTED, notPlaceholder)).toThrow(/does not carry/); // a swapped copy can never pass as a release
  });

  it('fails when nothing matched, and refuses a malformed or identical test key', () => {
    expect(() => swapKeyInTestCopy(stage(keyLine(), { marker: true }), COMMITTED, keyLine())).toThrow(/nothing to swap/);
    const copy = stage(COMMITTED, { marker: true });
    expect(() => swapKeyInTestCopy(copy, COMMITTED, 'not-a-key')).toThrow(/one line of base64/);
    expect(() => swapKeyInTestCopy(copy, COMMITTED, COMMITTED)).toThrow(/is the committed key/);
    expect(existsSync(path.join(copy, TEST_COPY_MARKER))).toBe(true);
  });
});
