'use client';

import { LOCALES, LOCALE_META, type Locale } from '@victorflow/i18n';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

const COOKIE = 'vf_lang';

/** English | العربية. Remembers the choice in a cookie (no personal data) and re-renders the page in that language. */
export function LanguageToggle({ current, label }: { current: Locale; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function choose(l: Locale) {
    if (l === current) return;
    document.cookie = `${COOKIE}=${l}; path=/; max-age=31536000; SameSite=Lax`;
    start(() => router.refresh());
  }

  return (
    <div role="radiogroup" aria-label={label} className="lang" aria-busy={pending}>
      {LOCALES.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={l === current} lang={l} dir={LOCALE_META[l].dir} onClick={() => choose(l)}>
          {LOCALE_META[l].nativeName}
        </button>
      ))}
    </div>
  );
}
