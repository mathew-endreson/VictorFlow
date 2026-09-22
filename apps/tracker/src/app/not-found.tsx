import { getI18n } from '@/i18n/server';

// Shown for a wrong token AND for an unknown order — deliberately identical, so nothing can be learned by probing.
export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <section className="card center">
      <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5M8.5 11h5" />
      </svg>
      <h1>{t('notFound.title')}</h1>
      <p className="muted">{t('notFound.body')}</p>
    </section>
  );
}
