'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'

import { BarChart } from '@/components/dashboard/bar-chart'
import { DateRangeFilter } from '@/components/dashboard/date-range-filter'
import { EmptyState, MetricCard } from '@/components/dashboard/metric-card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PipelineMetricsReport } from '@/server/services/dashboard'

export interface PipelineMetricsPanelProps {
  report: PipelineMetricsReport
}

/**
 * Pipeline Metrics tab — pipeline value per stage, conversion rates,
 * stage duration, lead counts, and closed-won/lost totals. Includes a
 * date-range filter that round-trips through URL query parameters so
 * switching windows triggers a Server Component re-fetch (Requirements
 * 28.1–28.7).
 *
 * Uses the shared `BarChart` and `DateRangeFilter` primitives so this
 * panel and the search page share the same visual vocabulary.
 *
 * Validates: Requirements 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7
 */
export function PipelineMetricsPanel({
  report,
}: PipelineMetricsPanelProps): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  // We mirror the report's date range into local state so the inputs
  // behave naturally — typing a partial date doesn't navigate away
  // until the user clicks Apply.
  const [from, setFrom] = useState(toInputValue(report.dateRange.from))
  const [to, setTo] = useState(toInputValue(report.dateRange.to))

  const applyRange = (nextFrom: string, nextTo: string): void => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (nextFrom) params.set('from', nextFrom)
    else params.delete('from')
    if (nextTo) params.set('to', nextTo)
    else params.delete('to')
    // Keep the active tab in the URL so the user stays on this panel.
    params.set('tab', 'pipeline')
    const qs = params.toString()
    startTransition(() => {
      router.push(qs ? `/?${qs}` : '/')
    })
  }

  const clearRange = (): void => {
    setFrom('')
    setTo('')
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('from')
    params.delete('to')
    params.set('tab', 'pipeline')
    startTransition(() => {
      router.push(`/?${params.toString()}`)
    })
  }

  // Stages excluded from open-pipeline value totals (won / lost are
  // terminal, the rest are "in motion").
  const openStages = report.stages.filter(
    (s) => !s.isClosedWon && !s.isClosedLost,
  )

  const stageValueBars = openStages.map((s) => ({
    label: s.stageName,
    value: s.value,
  }))

  const stageLeadBars = openStages.map((s) => ({
    label: s.stageName,
    value: s.leadCount,
  }))

  return (
    <div className="flex flex-col gap-4">
      <div
        aria-label="Filter pipeline metrics by date range"
        className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3"
      >
        <DateRangeFilter
          startDate={from}
          endDate={to}
          onStartDateChange={setFrom}
          onEndDateChange={setTo}
          onClear={clearRange}
        />
        <div className="ml-auto flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => applyRange(from, to)}
            disabled={isPending}
          >
            {isPending ? 'Applying…' : 'Apply'}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Closed won"
          value={report.closedSummary.closedWon}
          hint={formatDateRange(report.dateRange.from, report.dateRange.to)}
        />
        <MetricCard
          label="Closed lost"
          value={report.closedSummary.closedLost}
          hint={formatDateRange(report.dateRange.from, report.dateRange.to)}
        />
        <MetricCard
          label="Total pipeline value"
          value={formatCurrency(
            openStages.reduce((n, s) => n + s.value, 0),
          )}
          hint="Open stages only"
        />
        <MetricCard
          label="Total open leads"
          value={openStages.reduce((n, s) => n + s.leadCount, 0)}
        />
      </div>

      {openStages.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <BarChart
            title="Pipeline value by stage"
            items={stageValueBars}
            formatValue={formatCurrency}
          />
          <BarChart title="Open leads by stage" items={stageLeadBars} />
        </div>
      ) : null}

      {report.stages.length === 0 ? (
        <EmptyState
          title="No pipelines yet"
          description="Metrics appear here once a pipeline has been created."
        />
      ) : (
        <section
          aria-labelledby="pipeline-metrics-table"
          className="overflow-x-auto rounded-md border bg-card"
        >
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only" id="pipeline-metrics-table">
              Pipeline metrics by stage
            </caption>
            <thead className="bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2">
                  Pipeline
                </th>
                <th scope="col" className="px-4 py-2">
                  Stage
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Leads
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Value
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Conversion
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Avg. time
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {report.stages.map((s) => (
                <tr key={s.stageId}>
                  <td className="px-4 py-2 text-muted-foreground">
                    {s.pipelineName}
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="font-medium text-foreground">
                        {s.stageName}
                      </span>
                      {s.isClosedWon ? (
                        <StageFlag tone="won">Won</StageFlag>
                      ) : null}
                      {s.isClosedLost ? (
                        <StageFlag tone="lost">Lost</StageFlag>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.leadCount}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatCurrency(s.value)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatPercent(s.conversionRate)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.avgDurationMs == null
                      ? '—'
                      : formatDuration(s.avgDurationMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function StageFlag({
  tone,
  children,
}: {
  tone: 'won' | 'lost'
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        tone === 'won'
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
          : 'bg-destructive/10 text-destructive',
      )}
    >
      {children}
    </span>
  )
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function toInputValue(date: Date): string {
  // YYYY-MM-DD in the user's local timezone — <input type="date"> expects this.
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

function formatDuration(ms: number): string {
  const days = ms / (1000 * 60 * 60 * 24)
  if (days >= 1) return `${days.toFixed(1)}d`
  const hours = ms / (1000 * 60 * 60)
  if (hours >= 1) return `${hours.toFixed(1)}h`
  const minutes = ms / (1000 * 60)
  return `${minutes.toFixed(0)}m`
}

function formatDateRange(from: Date, to: Date): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  })
  return `${fmt.format(from)} – ${fmt.format(to)}`
}
