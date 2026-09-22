import { getI18n } from '@/i18n/server';

export default async function Home() {
  const { t } = await getI18n();
  return (
    <section className="card center">
      <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
        <path d="m3 8 9 5 9-5M12 13v8" />
      </svg>
      <h1>{t('home.title')}</h1>
      <p className="muted">{t('home.body')}</p>
    </section>
  );
}
