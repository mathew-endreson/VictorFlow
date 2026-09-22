import { PLURAL_CATEGORIES, type Catalog } from './core';

const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');
const placeholders = (s: string, ignoreCount = false) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .filter((p) => !(ignoreCount && p === 'count'))
    .sort()
    .join();

/** Arabic plural forms a message must provide when it is pluralised at all (`zero` is optional: it falls back to `other`). */
const REQUIRED_AR_FORMS = ['one', 'two', 'few', 'many', 'other'] as const;

/**
 * Completeness check for an English/Arabic catalog pair — used by every app's test suite, so a forgotten or
 * misspelt translation fails CI instead of showing a raw key on screen. Returns human-readable problems ([] = fine).
 */
export function checkCatalogPair(en: Catalog, ar: Catalog): string[] {
  const problems: string[] = [];
  const enBases = new Set(Object.keys(en).map(base));
  const arBases = new Set(Object.keys(ar).map(base));
  for (const k of enBases) if (!arBases.has(k)) problems.push(`missing in ar: ${k}`);
  for (const k of arBases) if (!enBases.has(k)) problems.push(`extra in ar: ${k}`);

  for (const k of arBases) {
    const present = PLURAL_CATEGORIES.filter((c) => ar[`${k}_${c}`] !== undefined);
    if (present.length === 0) continue;
    for (const c of REQUIRED_AR_FORMS) if (!present.includes(c)) problems.push(`ar plural ${k} lacks _${c}`);
  }
  for (const [k, v] of Object.entries(ar)) {
    if (!v.trim()) problems.push(`empty ar text: ${k}`);
    const source = en[k] ?? en[`${base(k)}_${k.slice(base(k).length + 1)}`] ?? en[`${base(k)}_other`];
    // "one", "two" and "zero" are usually written in words ("نتيجة واحدة"), so they may leave out {count}
    const wordy = /_(zero|one|two)$/.test(k);
    if (source !== undefined && placeholders(source, wordy) !== placeholders(v, wordy)) problems.push(`placeholders differ: ${k}`);
  }
  return problems;
}
