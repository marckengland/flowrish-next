'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Calendar, Clock, Users } from 'lucide-react'

import { cn } from '@/lib/utils'

interface DealGapEntry {
  leadId: string
  leadName: string
  companyName: string | null
  stage: string
  dealValue: number | null
  score: number
  riskLevel: 'healthy' | 'at_risk' | 'critical'
  lastActivityDaysAgo: number | null
}

interface DealGapsResponse {
  noActivitySevenDays: DealGapEntry[]
  noFutureMeeting: DealGapEntry[]
  singleThreaded: DealGapEntry[]
}

const SECTIONS = [
  {
    key: 'noActivitySevenDays' as const,
    title: 'No activity (7+ days)',
    icon: Clock,
    iconClass: 'text-red-600 dark:text-red-400',
    description:
      'These deals have gone cold — no emails, calls, or meetings in over a week.',
  },
  {
    key: 'noFutureMeeting' as const,
    title: 'No future meeting',
    icon: Calendar,
    iconClass: 'text-amber-600 dark:text-amber-400',
    description:
      'No upcoming meeting scheduled. Deals without next steps tend to stall.',
  },
  {
    key: 'singleThreaded' as const,
    title: 'Single-threaded',
    icon: Users,
    iconClass: 'text-purple-600 dark:text-purple-400',
    description:
      'Only one or no contacts linked. Multi-threading raises win rates significantly.',
  },
]

const RISK_COLOR: Record<DealGapEntry['riskLevel'], string> = {
  critical: 'text-red-600 dark:text-red-400',
  at_risk: 'text-amber-600 dark:text-amber-400',
  healthy: 'text-emerald-600 dark:text-emerald-400',
}

/**
 * "Deal gaps" panel — surfaces buckets of stalled or single-threaded
 * deals so reps can take corrective action. Each section shows the
 * top five most at-risk deals with quick-link rows; the full list is
 * available on the lead pages.
 *
 * The data is computed server-side by `GET /api/rhythm/deal-gaps`,
 * which composes per-lead engagement scores and gap detection across
 * the caller's accessible book of business.
 */
export function DealGapsPanel(): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery<DealGapsResponse>({
    queryKey: ['rhythm', 'deal-gaps'],
    queryFn: async () => {
      const res = await fetch('/api/rhythm/deal-gaps', {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error('Failed to load deal gaps')
      const body = (await res.json()) as { data: DealGapsResponse }
      return body.data
    },
  })

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Analyzing deal gaps…</p>
    )
  }
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error instanceof Error ? error.message : 'Failed to load deal gaps.'}
      </p>
    )
  }
  if (!data) return <></>

  return (
    <div className="space-y-4">
      {SECTIONS.map((section) => {
        const Icon = section.icon
        const deals = data[section.key]
        return (
          <section
            key={section.key}
            className="rounded-md border bg-card"
            aria-label={section.title}
          >
            <header className="flex items-center gap-2 border-b px-4 py-2.5">
              <Icon
                className={cn('size-4', section.iconClass)}
                aria-hidden="true"
              />
              <h3 className="text-sm font-semibold">{section.title}</h3>
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
                {deals.length}
              </span>
            </header>
            <p className="px-4 py-2 text-xs text-muted-foreground">
              {section.description}
            </p>
            {deals.length === 0 ? (
              <p className="px-4 pb-3 text-xs text-emerald-600 dark:text-emerald-400">
                No deals with this gap.
              </p>
            ) : (
              <ul className="divide-y">
                {deals.slice(0, 5).map((deal) => (
                  <li key={deal.leadId}>
                    <Link
                      href={`/leads/${deal.leadId}`}
                      className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/40"
                    >
                      <span
                        className={cn(
                          'text-xs font-bold tabular-nums',
                          RISK_COLOR[deal.riskLevel],
                        )}
                      >
                        {deal.score}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">
                          {deal.leadName}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {deal.companyName ?? deal.stage}
                          {deal.dealValue !== null
                            ? ` · $${deal.dealValue.toLocaleString()}`
                            : ''}
                        </p>
                      </div>
                      {deal.lastActivityDaysAgo !== null ? (
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {deal.lastActivityDaysAgo}d ago
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
                {deals.length > 5 ? (
                  <li className="px-4 py-2 text-xs text-muted-foreground">
                    +{deals.length - 5} more
                  </li>
                ) : null}
              </ul>
            )}
          </section>
        )
      })}

      {data.noActivitySevenDays.length === 0
        && data.noFutureMeeting.length === 0
        && data.singleThreaded.length === 0 ? (
        <p className="flex items-center gap-2 rounded-md border bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          <AlertTriangle className="size-4" aria-hidden="true" />
          Every open deal has recent activity, a future meeting, and at
          least two stakeholders. Nice work.
        </p>
      ) : null}
    </div>
  )
}
