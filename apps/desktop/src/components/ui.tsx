import { AlertCircle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Info, Inbox, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useI18n } from '@/i18n';
import { cx } from './cx';

export { cx };

/** Add to an icon that points somewhere (arrows, chevrons): it turns around in right-to-left layouts. */
export const FLIP = 'rtl:-scale-x-100';

/** Text that must always read left-to-right (codes, phone numbers, e-mails, URLs), even inside Arabic sentences. */
export const Ltr = ({ children, className }: { children: ReactNode; className?: string }) => (
  <bdi dir="ltr" className={cx('whitespace-nowrap', className)}>
    {children}
  </bdi>
);

// ── buttons ──────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-primaryink shadow-card hover:opacity-90 active:opacity-100',
  secondary: 'border border-line-strong bg-surface text-ink shadow-card hover:border-ink/50 hover:bg-surface2',
  danger: 'bg-bad text-white shadow-card hover:opacity-90',
  ghost: 'text-muted hover:bg-ink/5 hover:text-ink',
};

export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx('inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition disabled:pointer-events-none disabled:opacity-45', size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-4 text-[0.8125rem]', VARIANT[variant], className)}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

// ── form controls ────────────────────────────────────────────────────────────

const control = 'h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink shadow-[inset_0_1px_0_rgb(0_0_0/0.02)] transition placeholder:text-muted/80 hover:border-ink/40 focus:border-ink focus:outline-none focus:ring-3 focus:ring-brand/25 disabled:opacity-60';

/**
 * Free text may be Latin or Arabic in either interface language, so once a field has a value its direction follows that
 * value (`dir="auto"`); while empty it follows the page, which keeps the placeholder and caret on the reading side.
 */
const textDir = (dir: string | undefined, value: unknown) => dir ?? (typeof value === 'string' && value !== '' ? 'auto' : undefined);

export const Input = ({ className, dir, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} dir={textDir(dir, p.value)} className={cx(control, className)} />;

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cx('relative', className)}>
      <select {...p} className={cx(control, 'appearance-none pe-9')}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute inset-y-0 end-3 my-auto size-4 text-muted" />
    </div>
  );
}

export const Textarea = ({ className, dir, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} dir={textDir(dir, p.value)} className={cx(control, 'h-auto py-2 leading-snug', className)} />;

export function Field({ label, error, hint, required, children }: { label: string; error?: string | null; hint?: string; required?: boolean; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold text-ink/75">
        {label}
        {required && <span aria-hidden className="ms-0.5 text-brandfg"> *</span>}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}

// ── surfaces ─────────────────────────────────────────────────────────────────

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => <section className={cx('rounded-lg border border-line bg-surface shadow-card', className)}>{children}</section>;

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight">
          <span aria-hidden className="slash text-2xl" />
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Small uppercase section label used inside cards and modals. */
export const Eyebrow = ({ children, className }: { children: ReactNode; className?: string }) => <h3 className={cx('mb-2 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted', className)}>{children}</h3>;

type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet';
const TONE: Record<Tone, string> = {
  neutral: 'bg-ink/[0.06] text-muted',
  blue: 'bg-info/12 text-info',
  green: 'bg-ok/12 text-ok',
  amber: 'bg-warn/14 text-warn',
  red: 'bg-bad/12 text-bad',
  violet: 'bg-violet-500/12 text-violet-700 dark:text-violet-300',
};
export const Badge = ({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) => (
  <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', TONE[tone])}>
    <span aria-hidden className="size-1.5 rounded-full bg-current" />
    {children}
  </span>
);

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'neutral', SENT: 'blue', ACCEPTED: 'green', REJECTED: 'red', CONVERTED: 'violet',
  CONFIRMED: 'blue', IN_PRODUCTION: 'amber', QUALITY_CHECK: 'violet', COMPLETED: 'green', CANCELLED: 'red',
  ISSUED: 'blue', PARTIALLY_PAID: 'amber', PAID: 'green', POSTED: 'green',
  PENDING: 'neutral', IN_PROGRESS: 'amber',
};
export function StatusBadge({ status }: { status: string }) {
  const { status: label } = useI18n();
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{label(status)}</Badge>;
}

export function Spinner({ className }: { className?: string }) {
  const { t } = useI18n();
  return <span role="status" aria-label={t('common.loading')} className={cx('inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}

export function Loading({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-sm text-muted">
      <Spinner /> {label ?? t('common.loading')}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { error: text, t } = useI18n();
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-bad/30 bg-bad/8 px-4 py-3 text-sm text-bad">
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1">{text(error)}</span>
      {onRetry && (
        <button className="shrink-0 font-semibold underline underline-offset-2" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col items-center gap-2 px-4 py-14 text-center text-sm text-muted">
    <Inbox aria-hidden className="size-8 text-line-strong" strokeWidth={1.5} />
    <div>{children}</div>
  </div>
);

// ── tables ───────────────────────────────────────────────────────────────────
// Columns of numbers use `num`: aligned to the END edge (right in English, left in Arabic), digits fixed-width.

export const Table = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[640px] border-collapse text-start text-sm">{children}</table>
  </div>
);
export const Th = ({ children, num, className }: { children?: ReactNode; num?: boolean; className?: string }) => (
  <th className={cx('whitespace-nowrap border-b border-line bg-surface2 px-3.5 py-2.5 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted', num ? 'text-end' : 'text-start', className)}>{children}</th>
);
export const Td = ({ children, num, className, colSpan }: { children?: ReactNode; num?: boolean; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cx('border-b border-line px-3.5 py-3 align-middle', num && 'tabular whitespace-nowrap text-end', className)}>
    {children}
  </td>
);

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <div className="px-4 py-2.5 text-xs text-muted">{t('pager.results', { count: total })}</div>;
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-xs text-muted">
      <span>{t('pager.results', { count: total })}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('pager.prev')}>
          <ChevronLeft aria-hidden className={cx('size-4', FLIP)} />
        </Button>
        <span className="tabular">{t('pager.page', { page, pages })}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('pager.next')}>
          <ChevronRight aria-hidden className={cx('size-4', FLIP)} />
        </Button>
      </div>
    </div>
  );
}

// ── modal ────────────────────────────────────────────────────────────────────

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/55 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={cx('animate-pop flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop outline-none', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="flex min-w-0 items-center gap-2.5 text-base font-bold">
            <span aria-hidden className="slash text-base" />
            <span className="truncate">{title}</span>
          </h2>
          <button aria-label={t('common.close')} onClick={onClose} className="rounded-md p-1.5 text-muted transition hover:bg-ink/5 hover:text-ink">
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-surface2 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ── toasts ───────────────────────────────────────────────────────────────────

interface ToastItem { id: number; tone: 'ok' | 'error' | 'info'; message: string }
const ToastCtx = createContext<{ push: (tone: ToastItem['tone'], message: string) => void } | null>(null);

const TOAST_STYLE = { ok: 'border-s-ok', error: 'border-s-bad', info: 'border-s-info' } as const;
const TOAST_ICON = {
  ok: <CheckCircle2 aria-hidden className="size-[1.125rem] text-ok" />,
  error: <AlertCircle aria-hidden className="size-[1.125rem] text-bad" />,
  info: <Info aria-hidden className="size-[1.125rem] text-info" />,
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((tone: ToastItem['tone'], message: string) => {
    const id = ++seq.current;
    setItems((xs) => [...xs, { id, tone, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 3500);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 end-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className={cx('animate-pop pointer-events-auto flex items-start gap-3 rounded-lg border border-line border-s-4 bg-surface px-3.5 py-3 text-sm shadow-pop', TOAST_STYLE[t.tone])}>
            <span className="mt-px">{TOAST_ICON[t.tone]}</span>
            <span className="min-w-0 flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  const { error } = useI18n();
  if (!c) throw new Error('useToast must be used inside <ToastProvider>');
  return { ok: (m: string) => c.push('ok', m), error: (e: unknown) => c.push('error', error(e)), info: (m: string) => c.push('info', m) };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
