import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TrackingView } from '@/components/Timeline';
import { getI18n } from '@/i18n/server';
import { fetchTracking } from '@/lib/api';

// Live data, per request: never statically generated, never cached.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

interface Props {
  params: Promise<{ orderId: string; token: string }>;
}

export default async function TrackPage({ params }: Props) {
  const { orderId, token } = await params;
  const [result, i18n] = await Promise.all([fetchTracking(orderId, token), getI18n()]);

  if (result.kind === 'not-found') notFound();
  if (result.kind === 'error') {
    return (
      <section className="card center" role="alert">
        <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <h1>{i18n.t('unavailable.title')}</h1>
        <p className="muted">{i18n.t('unavailable.body')}</p>
      </section>
    );
  }
  return <TrackingView data={result.data} />;
}
