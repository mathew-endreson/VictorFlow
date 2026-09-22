import { cx } from './cx';

/**
 * The VP monogram (traced from the By.CREATIVE logo): a V and a P sharing one stroke, plus the red slash.
 * The black part follows `currentColor`, so it is dark on light surfaces and paper-white on the black sidebar.
 * The mark is never mirrored in right-to-left layouts — it is a logo, not an icon.
 */
export function Monogram({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 965 679" className={cx('shrink-0', className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <path fill="currentColor" d="M0 0H161L289 224L421 0H965L764 350H580L387 679L307 537L495 211H700L739 141H504L287 504Z" />
      <path className="fill-brand" d="M596 386H741L577 671H431Z" />
    </svg>
  );
}

/** "By.CREATIVE" as set in the logo: a light red "By." and a heavy, widely spaced "CREATIVE". */
export function ByCreative({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={cx('inline-flex items-baseline gap-px leading-none', className)}>
      <span className="font-light text-brand">By.</span>
      <span className="font-extrabold tracking-[0.16em]">CREATIVE</span>
    </span>
  );
}

/** Monogram + product name + the studio credit — the sidebar and login lock-up. */
export function BrandLockup({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Monogram className={compact ? 'w-9' : 'w-11'} />
      <div className="min-w-0 leading-tight">
        <div className={cx('font-bold tracking-tight', compact ? 'text-[1.05rem]' : 'text-xl')}>VictorFlow</div>
        <ByCreative className="mt-1 text-[0.6rem] text-current opacity-80" />
      </div>
    </div>
  );
}
