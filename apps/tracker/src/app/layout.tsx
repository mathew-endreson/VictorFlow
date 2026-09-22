import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/jost/wght.css';
import '@fontsource-variable/cairo/wght.css';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Monogram } from '@/components/Monogram';
import { getI18n } from '@/i18n/server';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#181718' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, dir, t } = await getI18n();
  return (
    <html lang={locale} dir={dir}>
      <body>
        <header className="top">
          <div className="top-inner">
            <div className="brand">
              <Monogram className="mark" />
              <div>
                <div className="brand-name">VictorFlow</div>
                <span className="by">
                  <i>By.</i>CREATIVE
                </span>
              </div>
            </div>
            <LanguageToggle current={locale} label={t('common.language')} />
          </div>
        </header>
        <main className="shell">
          {children}
          <footer className="foot">{t('foot.text')}</footer>
        </main>
      </body>
    </html>
  );
}
