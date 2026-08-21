import { cn } from '@/lib/utils'

/**
 * Loading placeholder. A muted, pulsing block used to reserve layout space
 * while async content loads, so pages fill in smoothly instead of popping.
 *
 * Decorative by default (`aria-hidden`): the surrounding region should carry
 * an `aria-busy`/`role="status"` so assistive tech announces the loading
 * state without reading out every placeholder bar.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn('motion-safe:animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}
