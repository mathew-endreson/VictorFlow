import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/jost/wght.css';
import '@fontsource-variable/cairo/wght.css';
import { displayMessages } from '@/i18n/messages';
import './globals.css';

export const metadata: Metadata = {
  title: displayMessages.fr['meta.title'],
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#121112' };

export default function RootLayout({ children }: { children: ReactNode }) {
  // The page itself mixes three languages; each block carries its own lang/dir.
  return (
    <html lang="fr" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
