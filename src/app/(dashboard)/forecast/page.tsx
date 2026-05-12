import { redirect } from 'next/navigation'

import { CommitForm } from '@/components/forecast/commit-form'
import { ForecastPanel } from '@/components/forecast/forecast-panel'
import { RiskIndicator } from '@/components/forecast/risk-indicator'
import { MetricCard, EmptyState } from '@/components/dashboard/metric-card'
import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import {
  assessForecastRisk,
  calculatePipelineMetrics,
  calculateWinRate,
} from '@/server/services/forecast'

/**
 * Forecast page — Server Component.
 *
 * Fetches pipeline metrics, the current user's latest commit for the
 * period, and the resulting risk classification so the page paints
 * fully hydrated. All three child components are composed here:
 * - `ForecastPanel` — total / weighted / AI predicted / win rate
 * - `CommitForm`    — submit a commit (uncontrolled, Server Action)
 * - `RiskIndicator` — On Track / At Risk / High Risk badge
 *
 * Permission model:
 * - `forecast:read` is required to reach this page at all.
 * - `forecast:submit` enables the commit form; otherwise it renders
 *   read-only so members can still view the metrics.
 *
 * Validates: Requirements 10.1, 10.2, 10.3
 */
export default async function ForecastPage(): Promise<React.JSX.Element> {
  const session = await requireSession()
  if (!session) redirect('/login')

  // Gate the entire route on `forecast:read`.
  if (!hasPermission(session.dbUser, 'forecast:read')) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">Forecast</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view the forecast for this
          organization.
        </p>
      </div>
    )
  }

  const canSubmit = hasPermission(session.dbUser, 'forecast:submit')
  const orgId = session.organizationId
  const userId = session.dbUser.id

  const period = currentPeriod()
  const db = createTenantPrisma(orgId)

  // Fetch everything needed to render the page in parallel.
  const [metrics, winRate, latestSubmission] = await Promise.all([
    calculatePipelineMetrics(orgId),
    calculateWinRate(orgId),
    db.forecastSubmission.findFirst({
      where: { userId, period },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        period: true,
        commitAmount: true,
        notes: true,
        createdAt: true,
      },
    }),
  ])

  const teamCommit = latestSubmission
    ? Number(latestSubmission.commitAmount)
    : null
  const risk =
    teamCommit === null
      ? null
      : assessForecastRisk(teamCommit, metrics.aiPredicted)

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Forecast</h1>
        <p className="text-sm text-muted-foreground">
          Pipeline metrics, team commits and commit vs AI risk for the
          current period.
        </p>
      </header>

      <section aria-labelledby="forecast-metrics-heading" className="space-y-3">
        <h2
          id="forecast-metrics-heading"
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Pipeline metrics
        </h2>
        <ForecastPanel
          totalPipeline={metrics.totalPipeline}
          weightedPipeline={metrics.weightedPipeline}
          aiPredicted={metrics.aiPredicted}
          winRate={winRate}
        />
      </section>

      <section
        aria-labelledby="forecast-commit-heading"
        className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      >
        <div className="space-y-3">
          <h2
            id="forecast-commit-heading"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Your commit ({period})
          </h2>
          <CommitForm
            defaultPeriod={period}
            defaultCommitAmount={teamCommit}
            defaultNotes={latestSubmission?.notes ?? null}
            canSubmit={canSubmit}
          />
        </div>

        <div className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Commit vs AI
          </h2>
          {teamCommit === null || risk === null ? (
            <EmptyState
              title={`No commit submitted for ${period}`}
              description={
                canSubmit
                  ? 'Submit a commit to see risk classification.'
                  : 'Ask a manager to submit a commit to see risk classification.'
              }
            />
          ) : (
            <div className="flex flex-col gap-3 rounded-md border bg-card p-4 shadow-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <MetricCard
                  label={`Your commit (${period})`}
                  value={formatCurrency(teamCommit)}
                />
                <MetricCard
                  label="AI predicted"
                  value={formatCurrency(metrics.aiPredicted)}
                  hint={formatGap(teamCommit, metrics.aiPredicted)}
                />
              </div>
              <RiskIndicator risk={risk} context={period} />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatGap(teamCommit: number, aiPredicted: number): string {
  if (aiPredicted === 0) return 'AI prediction is zero'
  const gapPct = ((teamCommit - aiPredicted) / aiPredicted) * 100
  const sign = gapPct > 0 ? '+' : ''
  return `Gap: ${sign}${gapPct.toFixed(1)}%`
}
