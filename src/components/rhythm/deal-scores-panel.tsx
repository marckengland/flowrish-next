'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface DealScore {
  leadId: string
  leadName: string
  companyName: string | null
  stage: string
  dealValue: number | null
  currency: string | null
  score: number
  riskLevel: 'healthy' | 'at_risk' | 'critical'
  stakeholderCount: number
  lastActivityDaysAgo: number | null
}

/**
 * "Deal scores" list card for the Rhythm right rail. A compact roster of
 * open deals — lead name plus a band-colored, tabular score — sorted by
 * lowest score first so the most urgent work sits at the top. Each row
 * links to the lead.
 *
 * Score color follows the shared band convention used across the app
 * (≥70 danger, ≥50 warning, else neutral) so the number reads
 * consistently with the score circles and badges elsewhere.
 *
 * Backed by `GET /api/rhythm/deal-scores`.
 */
export function DealScoresPanel(): React.JSX.Element {
  const { data: scores = [], isLoading, isError, error } = useQuery<
    DealScore[]
  >({
    queryKey: ['rhythm', 'deal-scores'],
    queryFn: async () => {
      const res = await fetch('/api/rhythm/deal-scores', {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error('Failed to load deal scores')
      const body = (await res.json()) as { data: DealScore[] }
      return body.data
    },
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Deal scores</CardTitle>
      </CardHeader>

      {isLoading ? (
        <p className="px-[18px] py-3.5 text-sm text-muted-foreground">
          Loading deal scores…
        </p>
      ) : isError ? (
        <p role="alert" className="px-[18px] py-3.5 text-sm text-danger-foreground">
          {error instanceof Error ? error.message : 'Failed to load deal scores.'}
        </p>
      ) : scores.length === 0 ? (
        <p className="px-[18px] py-3.5 text-sm text-muted-foreground">
          No open deals to score.
        </p>
      ) : (
        <ul className="divide-y divide-row-divider">
          {scores.map((deal) => (
            <li key={deal.leadId}>
              <Link
                href={`/leads/${deal.leadId}`}
                className="flex items-center justify-between gap-3 px-[18px] py-2.5 transition-colors hover:bg-background"
              >
                <span className="truncate text-[13px] text-foreground/80">
                  {deal.leadName}
                </span>
                <span
                  className={cn(
                    'font-mono text-xs font-semibold tnum',
                    scoreToneClass(deal.score),
                  )}
                >
                  {deal.score}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function scoreToneClass(score: number): string {
  if (score >= 70) return 'text-danger-foreground'
  if (score >= 50) return 'text-warning-foreground'
  return 'text-muted-foreground'
}
