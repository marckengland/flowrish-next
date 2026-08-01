/**
 * Small "Private beta" pill. Purely presentational — callers decide when to
 * show it (typically gated by the WAITLIST_ENABLED flag on the auth screens).
 */
export function PrivateBetaBadge({
  className = '',
}: {
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 font-mono text-[11px] font-medium tracking-[0.04em] text-brand-emphasis ${className}`}
    >
      <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
      Private beta
    </span>
  )
}
