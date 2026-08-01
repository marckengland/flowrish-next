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
 * Score bands (design handoff):
 *   - 70–100  red tint    (high)
 *   - 50–69   amber tint  (medium)
 *   -  0–49   neutral     (low)
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

/**
 * Band tones per the design handoff:
 *   - high  (≥70)   red tint    ("high-score badges")
 *   - medium (50–69) amber tint  ("medium score badges")
 *   - low   (<50)   neutral gray
 */
function scoreToneClass(score: number): string {
  if (score >= 70) return 'bg-danger-subtle text-danger-foreground'
  if (score >= 50) return 'bg-warning-subtle text-warning-foreground'
  return 'bg-muted text-muted-foreground'
}

interface ScoreCircleProps {
  score: number
  className?: string
}

/**
 * Band-colored score circle used in priority queues (dashboard "Top
 * priorities", Rhythm queue). Matches the design's 36px tinted circle
 * with tabular numerals.
 */
export function ScoreCircle({
  score,
  className,
}: ScoreCircleProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums',
        scoreToneClass(clamped),
        className,
      )}
      title={`Score: ${clamped}`}
    >
      {clamped}
    </span>
  )
}
