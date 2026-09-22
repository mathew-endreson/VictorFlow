/** The VP monogram (traced from the By.CREATIVE logo). Never mirrored in right-to-left layouts — it is a logo. */
export function Monogram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 965 679" className={className} aria-hidden focusable="false">
      <path fill="currentColor" d="M0 0H161L289 224L421 0H965L764 350H580L387 679L307 537L495 211H700L739 141H504L287 504Z" />
      <path fill="var(--brand)" d="M596 386H741L577 671H431Z" />
    </svg>
  );
}
