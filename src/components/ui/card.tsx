import { cn } from '@/lib/utils'

/**
 * Card surface primitives matching the design handoff: white surface,
 * 1px hairline border, 12px radius. Compose `Card` with `CardHeader`,
 * `CardTitle`, and `CardContent` for the common titled-card pattern.
 */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-lg border bg-card text-card-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'flex items-center justify-between gap-3 border-b px-[18px] py-3.5',
        className,
      )}
      {...props}
    />
  )
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return (
    <h3
      data-slot="card-title"
      className={cn('text-sm font-semibold text-foreground', className)}
      {...props}
    />
  )
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      data-slot="card-content"
      className={cn('p-[18px]', className)}
      {...props}
    />
  )
}
