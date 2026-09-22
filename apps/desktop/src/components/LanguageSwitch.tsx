import { Globe } from 'lucide-react';
import { LOCALES, LOCALE_META, useI18n } from '@/i18n';
import { cx } from './cx';

/** English | العربية — a two-way switch. Each language is written in itself, so it can always be found. */
export function LanguageSwitch({ tone = 'light', className }: { tone?: 'light' | 'dark'; className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const dark = tone === 'dark';
  return (
    <div role="radiogroup" aria-label={t('common.language')} className={cx('inline-flex items-center gap-1 rounded-md p-0.5', dark ? 'bg-white/8' : 'border border-line-strong bg-surface', className)}>
      <Globe aria-hidden className={cx('mx-1.5 size-3.5 shrink-0', dark ? 'text-sideink' : 'text-muted')} />
      {LOCALES.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={active}
            lang={l}
            dir={LOCALE_META[l].dir}
            onClick={() => setLocale(l)}
            className={cx(
              'rounded px-2.5 py-1 text-xs font-semibold transition',
              active ? (dark ? 'bg-white text-[#1f1e1f]' : 'bg-primary text-primaryink') : dark ? 'text-sideink hover:bg-white/10 hover:text-white' : 'text-muted hover:text-ink',
            )}
          >
            {LOCALE_META[l].nativeName}
          </button>
        );
      })}
    </div>
  );
}
