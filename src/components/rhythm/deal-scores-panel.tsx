'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react'

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

const TONE: Record<
  DealScore['riskLevel'],
  { color: string; bg: string; icon: typeof CheckCircle }
> = {
  healthy: {
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-100 dark:bg-emerald-900/40',
    icon: CheckCircle,
  },
  at_risk: {
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    icon: AlertTriangle,
  },
  critical: {
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-100 dark:bg-red-900/40',
    icon: XCircle,
  },
}

/**
 * Engagement-score panel for the Rhythm dashboard. Renders a
 * three-card summary (total / at-risk / healthy) plus the full list of
 * scored deals sorted by lowest score first so the most urgent work is
 * surfaced at the top.
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

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading deal scores…</p>
    )
  }
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error instanceof Error
          ? error.message
          : 'Failed to load deal scores.'}
      </p>
    )
  }
  if (scores.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No open deals to score.</p>
    )
  }

  const atRisk = scores.filter((s) => s.riskLevel !== 'healthy').length
  const healthy = scores.length - atRisk

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Total open deals" value={scores.length} />
        <SummaryCard
          label="At risk"
          value={atRisk}
          tone="text-amber-600 dark:text-amber-400"
        />
        <SummaryCard
          label="Healthy"
          value={healthy}
          tone="text-emerald-600 dark:text-emerald-400"
        />
      </div>

      <ul className="space-y-2">
        {scores.map((deal) => {
          const tone = TONE[deal.riskLevel]
          const RiskIcon = tone.icon
          return (
            <li key={deal.leadId}>
              <Link
                href={`/leads/${deal.leadId}`}
                className="flex items-center gap-3 rounded-md border bg-card p-3 transition-colors hover:bg-muted/40"
              >
                <div
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-full',
                    tone.bg,
                  )}
                >
                  <span
                    className={cn('text-sm font-bold', tone.color)}
                  >
                    {deal.score}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {deal.leadName}
                    </p>
                    <RiskIcon
                      className={cn('size-3.5', tone.color)}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {deal.companyName ? <span>{deal.companyName}</span> : null}
                    <span>·</span>
                    <span>{deal.stage}</span>
                    {deal.dealValue !== null ? (
                      <>
                        <span>·</span>
                        <span>
                          ${deal.dealValue.toLocaleString()}
                          {deal.currency ? (
                            <span className="ml-0.5 text-[10px] uppercase">
                              {deal.currency}
                            </span>
                          ) : null}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  {deal.lastActivityDaysAgo !== null ? (
                    <p>{deal.lastActivityDaysAgo}d ago</p>
                  ) : null}
                  <p>
                    {deal.stakeholderCount} contact
                    {deal.stakeholderCount === 1 ? '' : 's'}
                  </p>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: string
}): React.JSX.Element {
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone ?? 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}
