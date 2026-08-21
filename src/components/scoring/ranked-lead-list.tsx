'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { DollarSign, User } from 'lucide-react'

import { ScoreBadge } from '@/components/scoring/score-badge'

interface RankedLead {
  id: string
  firstName: string
  lastName: string
  score: number
  dealValue: number | null
  currency: string | null
  stage: { id: string; name: string } | null
  assignedUser: { id: string; name: string } | null
}

/**
 * Ranked lead list — renders open leads sorted by score descending.
 *
 * Each row links to the lead detail page so the user can dive into the
 * top-scored opportunity in one click. The deal-value and assignee
 * subtitles only render when present so empty data doesn't make the
 * row look broken.
 */
export function RankedLeadList(): React.JSX.Element {
  const { data: leads, isLoading, isError, error } = useQuery<RankedLead[]>({
    queryKey: ['leads', 'ranked'],
    queryFn: async () => {
      const res = await fetch('/api/leads/ranked', {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error('Failed to load ranked leads')
      const body = (await res.json()) as { data: RankedLead[] }
      return body.data
    },
  })

  if (isLoading) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        Loading ranked leads…
      </p>
    )
  }

  if (isError) {
    return (
      <p role="alert" className="px-4 py-3 text-sm text-danger-foreground">
        {error instanceof Error
          ? error.message
          : 'Failed to load ranked leads.'}
      </p>
    )
  }

  if (!leads || leads.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        No open leads to rank yet.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-row-divider">
      {leads.map((lead) => (
        <li key={lead.id}>
          <Link
            href={`/leads/${lead.id}`}
            className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground">
                {lead.firstName} {lead.lastName}
              </p>
              <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
                {lead.stage ? <span>{lead.stage.name}</span> : null}
                {lead.dealValue !== null ? (
                  <span className="flex items-center gap-1">
                    <DollarSign className="size-3" aria-hidden="true" />
                    {lead.dealValue.toLocaleString()}
                    {lead.currency ? (
                      <span className="text-[10px] uppercase">
                        {lead.currency}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {lead.assignedUser ? (
                  <span className="flex items-center gap-1">
                    <User className="size-3" aria-hidden="true" />
                    {lead.assignedUser.name}
                  </span>
                ) : null}
              </div>
            </div>
            <ScoreBadge score={lead.score} size="md" className="shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
