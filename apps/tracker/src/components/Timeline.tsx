import type { PublicTrackingDto } from '@victorflow/types';
import { getI18n } from '@/i18n/server';

export async function TrackingView({ data }: { data: PublicTrackingDto }) {
  const { t, tOr, fmt } = await getI18n();
  const finished = data.status.key === 'COMPLETED';
  // The server names each step in English; the step's stable key is what gets translated.
  const step = (key: string, serverLabel: string) => tOr(`tracking.step.${key}`, serverLabel);

  return (
    <>
      <section className="card" aria-labelledby="order-title">
        <p className="eyebrow">{t('order.label')}</p>
        <h1 id="order-title"><bdi dir="ltr">{data.orderNumber}</bdi></h1>
        <span className={`pill ${data.cancelled ? 'cancelled' : finished ? 'done' : 'active'}`}>{step(data.status.key, data.status.label)}</span>
        <div className="meta">
          <span><b>{t('order.placed')}</b>{fmt.longDate(data.placedAt)}</span>
          {data.expectedDate && <span><b>{t('order.expected')}</b>{fmt.longDate(data.expectedDate)}</span>}
        </div>
      </section>

      {!data.cancelled && (
        <section className="card" aria-labelledby="progress-title">
          <h2 id="progress-title"><span className="slash" aria-hidden />{t('order.progress')}</h2>
          <ol className="steps">
            {data.steps.map((s) => (
              <li key={s.key} className={`step ${s.done ? 'done' : ''} ${s.current ? 'current' : ''}`} aria-current={s.current ? 'step' : undefined}>
                <span className="dot" aria-hidden>✓</span>
                <div>
                  <div className="label">{step(s.key, s.label)}</div>
                  {s.at && <div className="when">{fmt.dateTime(s.at)}</div>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.items.length > 0 && (
        <section className="card" aria-labelledby="items-title">
          <h2 id="items-title"><span className="slash" aria-hidden />{t('order.items')}</h2>
          <ul className="items">
            {data.items.map((i, idx) => (
              <li key={idx}>
                <span>{i.description}</span>
                <span className="muted ltr">{Number(i.quantity)} {i.unit}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
