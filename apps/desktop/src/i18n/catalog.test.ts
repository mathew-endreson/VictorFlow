import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCatalogPair } from '@victorflow/i18n';
import { describe, expect, it } from 'vitest';
import { arMessages, enMessages } from '@/i18n';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const baseOf = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');
const enBases = new Set(Object.keys(enMessages).map(baseOf));

// Arabic-only data names (the chart of accounts and journals): English shows the names stored in the database.
const DATA_NAMES = /^(account|journal)\./;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(f) && !/\.test\./.test(f) && !p.includes(`${join('src', 'i18n')}${'\\'}`) && !p.includes('src/i18n/') ? [p] : [];
  });
}

describe('desktop catalogs', () => {
  it('Arabic has exactly the messages English has, the same placeholders, and every plural form Arabic needs', () => {
    const arCore = Object.fromEntries(Object.entries(arMessages).filter(([k]) => !DATA_NAMES.test(k)));
    expect(checkCatalogPair(enMessages, arCore)).toEqual([]);
  });

  it('every t("…") in the source has an English message (so no raw key ever reaches the screen)', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([\w.]+)'/g)) if (!enBases.has(m[1]!)) missing.push(`${file.slice(SRC.length)}: ${m[1]}`);
      for (const m of text.matchAll(/label: '([\w.]+)'/g)) if (m[1]!.startsWith('nav.') && !enBases.has(m[1]!)) missing.push(`${file.slice(SRC.length)}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it('has the messages that are looked up by data rather than written out (line problems, workflow moves)', () => {
    for (const code of ['description', 'quantity', 'unitPrice', 'discount', 'tva']) expect(enBases.has(`editor.problem.${code}`), code).toBe(true);
    for (const move of ['DRAFT.CONFIRMED', 'CONFIRMED.IN_PRODUCTION', 'IN_PRODUCTION.QUALITY_CHECK', 'QUALITY_CHECK.COMPLETED', 'QUALITY_CHECK.REJECTED', 'REJECTED.IN_PRODUCTION']) {
      expect(enBases.has(`move.${move}`), move).toBe(true);
      expect(arMessages[`move.${move}`], move).toBeTruthy();
    }
  });

  it('names every seeded account and journal in Arabic', () => {
    const codes = ['101', '213', '218', '300', '310', '320', '401', '411', '421', '431', '4456', '44566', '4457', '44571', '512', '530', '600', '601', '602', '613', '631', '700', '701', '706'];
    for (const c of codes) expect(arMessages[`account.${c}`], `account ${c}`).toBeTruthy();
    for (const j of ['VTE', 'ACH', 'BNQ', 'CAI', 'OD']) expect(arMessages[`journal.${j}`], `journal ${j}`).toBeTruthy();
  });
});
