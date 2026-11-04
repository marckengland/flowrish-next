import { forecastPeriod } from '@/lib/forecast-period'
import { redirect } from 'next/navigation'

import { CommitForm } from '@/components/forecast/commit-form'
import { ForecastPanel } from '@/components/forecast/forecast-panel'
import { RiskIndicator } from '@/components/forecast/risk-indicator'
import { EmptyState } from '@/components/dashboard/metric-card'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { AppError } from '@/lib/errors'
import { requireEntitlement } from '@/server/auth/entitlements'
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

  try {
    await requireEntitlement(session.organizationId, 'forecasting')
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'UPGRADE_REQUIRED') throw error
    return <div className="rounded-md border bg-card p-6"><h1 className="text-lg font-semibold">Forecast</h1><p>Forecasting isn’t enabled for this business.</p></div>
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
    <div className="flex max-w-[1000px] flex-col gap-[18px]">
      <PageHeader
        title="Forecast"
        description={`${period} · commit with confidence`}
      />

      <section aria-labelledby="forecast-metrics-heading">
        <h2 id="forecast-metrics-heading" className="sr-only">
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
        className="grid items-start gap-[18px] lg:grid-cols-[1.2fr_1fr]"
      >
        <h2 id="forecast-commit-heading" className="sr-only">
          Your commit and commit vs AI
        </h2>

        <CommitForm
          defaultPeriod={period}
          defaultCommitAmount={teamCommit}
          defaultNotes={latestSubmission?.notes ?? null}
          canSubmit={canSubmit}
        />

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
          <Card>
            <CardContent className="p-5">
              <div className="mb-4 text-sm font-semibold text-foreground">
                Commit vs AI
              </div>
              <CommitVsAiBars
                teamCommit={teamCommit}
                aiPredicted={metrics.aiPredicted}
              />
              <div className="mt-[18px]">
                <RiskIndicator risk={risk} context={period} />
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}

/**
 * Two-bar comparison of the team commit (ink) against the AI-predicted
 * value (emerald), each scaled against the larger of the two so the wider
 * bar always fills the track. Purely presentational.
 */
function CommitVsAiBars({
  teamCommit,
  aiPredicted,
}: {
  teamCommit: number
  aiPredicted: number
}): React.JSX.Element {
  const max = Math.max(teamCommit, aiPredicted, 1)
  const commitPct = Math.round((teamCommit / max) * 100)
  const aiPct = Math.round((aiPredicted / max) * 100)
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12.5px] text-muted-foreground">Team commit</span>
        <span className="text-xl font-semibold tnum text-foreground">
          {formatCurrency(teamCommit)}
        </span>
      </div>
      <div className="mb-4 h-[9px] overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground"
          style={{ width: `${commitPct}%` }}
        />
      </div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12.5px] text-muted-foreground">AI predicted</span>
        <span className="text-xl font-semibold tnum text-brand-emphasis">
          {formatCurrency(aiPredicted)}
        </span>
      </div>
      <div className="h-[9px] overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${aiPct}%` }}
        />
      </div>
    </div>
  )
}

function currentPeriod(): string {
  return forecastPeriod()
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}
