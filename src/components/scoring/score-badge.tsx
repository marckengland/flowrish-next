import { cn } from '@/lib/utils'

interface ScoreBadgeProps {
  score: number
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Color-tiered score badge. Reused on the ranked lead list, the lead
 * detail header, and inside Kanban cards.
 *
 * Score tiers (matching the original Flowrish UX):
 *   - 75–100  green  (hot)
 *   - 50–74   blue   (warm)
 *   - 25–49   amber  (cool)
 *   -  0–24   red    (cold)
 *
 * Scores outside [0, 100] are clamped before display so a badly-shaped
 * upstream value doesn't render with broken styling.
 */
export function ScoreBadge({
  score,
  size = 'sm',
  className,
}: ScoreBadgeProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold tabular-nums',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        scoreToneClass(clamped),
        className,
      )}
      title={`Lead score: ${clamped}`}
    >
      {clamped}
    </span>
  )
}

function scoreToneClass(score: number): string {
  if (score >= 75)
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  if (score >= 50)
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  if (score >= 25)
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
}
