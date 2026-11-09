import { forecastBasisStatus } from '@/lib/forecast-basis'
import { forecastPeriod } from '@/lib/forecast-period'
import Link from 'next/link'
import { NeedsCheckingSummary } from '@/components/dashboard/needs-checking-summary'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'

import {
  DashboardTabs,
  type DashboardTabItem,
} from '@/components/dashboard/dashboard-tabs'
import { PageHeader } from '@/components/layout/page-header'
import { buttonVariants } from '@/components/ui/button'
import { CommitVsAiPanel } from '@/components/dashboard/panels/commit-vs-ai'
import {
  DealGapsPanel,
  type DealGapRow,
} from '@/components/dashboard/panels/deal-gaps'
import {
  DealHealthPanel,
  type DealHealthRow,
} from '@/components/dashboard/panels/deal-health'
import { ForecastPanel } from '@/components/dashboard/panels/forecast'
import { PipelineMetricsPanel } from '@/components/dashboard/panels/pipeline-metrics'
import {
  TeamViewPanel,
  type TeamRepSummary,
} from '@/components/dashboard/panels/team-view'
import {
  TodaysRhythmPanel,
  type RhythmActionRow,
} from '@/components/dashboard/panels/todays-rhythm'
import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from '@/server/services/access'
import { createTenantPrisma } from '@/server/db/middleware'
import { prisma } from '@/server/db/client'
import { getPipelineMetrics } from '@/server/services/dashboard'
import {
  assessForecastRisk,
  calculatePipelineMetrics,
  calculateWinRate,
} from '@/server/services/forecast'
import {
  calculatePriorityScore,
  getRhythmSnapshot,
} from '@/server/services/rhythm'

/**
 * Dashboard home page
 *
 * Server Component that fetches all data via tenant-scoped Prisma queries
 * and renders a tabbed view. Visible tabs are gated by role — the two
 * Manager-only tabs (Team View and Commit vs AI) are filtered out for
 * MEMBER-level users.
 *
 * Data fetching strategy:
 * - Everything is resolved server-side in this function. The tab component
 *   is the only client boundary — switching tabs is instant because all
 *   panels are already hydrated with data.
 * - The Pipeline Metrics tab reads `from` / `to` query params so date
 *   range changes re-run this Server Component rather than fetching via
 *   the client (Requirement 28.6).
 *
 * Validates: Requirements 9.3, 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}): Promise<React.JSX.Element> {
  const session = await requireSession()
  // Defense-in-depth: the layout already redirects, but keep the guard so
  // this component can be reasoned about in isolation.
  if (!session) redirect('/login')

  if (!hasPermission(session.dbUser, 'leads:read')) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You don&apos;t have permission to view the dashboard in this
          organization.
        </p>
      </div>
    )
  }
  const canWrite = hasPermission(session.dbUser, 'leads:write')
  const orgId = session.organizationId
  const userId = session.dbUser.id
  const params = (await searchParams) ?? {}

  // ── Role resolution (Manager+ sees Team View + Commit vs AI) ───────────────
  const hierarchy = session.dbUser.teamMemberships.length
    ? Math.min(...session.dbUser.teamMemberships.map((m) => m.role.hierarchy))
    : Infinity
  const isManagerOrAbove = hierarchy <= 2

  // ── Resolve current period for Commit vs AI (YYYY-MM) ──────────────────────
  const now = new Date()
  const currentPeriod = forecastPeriod(now)

  // ── Fetch everything we need in parallel ───────────────────────────────────
  // Pipeline metrics (respects ?from / ?to date range)
  const metricsRange = parseDateRange(params)
  const metricsPromise = getPipelineMetrics(orgId, metricsRange)

  // Forecast headline metrics + win rate
  const forecastPromise = calculatePipelineMetrics(orgId)
  const ownerForecastPromise = isManagerOrAbove ? calculatePipelineMetrics(orgId, userId) : Promise.resolve(null)
  const winRatePromise = calculateWinRate(orgId)

  // Tasks to feed Today's Rhythm + (optionally) Team View
  const db = createTenantPrisma(orgId)
  const myTasksPromise = db.task.findMany({
    where: { assigneeId: userId, isComplete: false },
    include: {
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          score: true,
          dealValue: true,
          lastActivityAt: true,
        },
      },
    },
    orderBy: { dueDate: 'asc' },
  })

  // Open leads (excluding closed won/lost) for Deal Health + Deal Gaps
  const accessFilter = await getLeadAccessFilter(session.dbUser, orgId)
  const openLeadsPromise = db.lead.findMany({
    where: { ...accessFilter, isClosed: false, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dealValue: true,
    },
    take: 500, // safety cap — richer scoring will paginate later
  })

  // Current-period commit for Commit vs AI (manager-only)
  const commitPromise = isManagerOrAbove
    ? prisma.forecastSubmission.findFirst({
        where: { organizationId: orgId, userId, period: currentPeriod },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    : Promise.resolve(null)

  // Team members (manager+ only) for Team View
  const teamMembersPromise: Promise<{ userId: string; name: string }[]> =
    isManagerOrAbove
      ? resolveTeamMembers(userId, orgId, hierarchy)
      : Promise.resolve([])

  const [
    metricsReport,
    forecastMetrics,
    ownerForecastMetrics,
    winRate,
    myTasks,
    openLeads,
    commit,
    teamMembers,
  ] = await Promise.all([
    metricsPromise,
    forecastPromise,
    ownerForecastPromise,
    winRatePromise,
    myTasksPromise,
    openLeadsPromise,
    commitPromise,
    teamMembersPromise,
  ])

  // ── Derived: Today's Rhythm ────────────────────────────────────────────────
  const rankedMyTasks = myTasks
    .map((t) => ({
      task: t,
      score: calculatePriorityScore({
        dueDate: t.dueDate,
        dealValue: t.lead.dealValue ? Number(t.lead.dealValue) : null,
        leadScore: t.lead.score ?? null,
        lastActivityAt: t.lead.lastActivityAt,
        priority: t.priority,
      }),
    }))
    .sort((a, b) => b.score - a.score)

  const nowMs = Date.now()
  const rhythmActions: RhythmActionRow[] = rankedMyTasks
    .slice(0, 5)
    .map((r) => ({
      id: r.task.id,
      title: r.task.title,
      dueDate: r.task.dueDate,
      priorityScore: r.score,
      isOverdue: r.task.dueDate.getTime() < nowMs,
      leadId: r.task.lead.id,
      leadName: `${r.task.lead.firstName} ${r.task.lead.lastName}`.trim(),
    }))
  const overdueCount = rankedMyTasks.filter(
    (r) => r.task.dueDate.getTime() < nowMs,
  ).length
  const todayCount = rankedMyTasks.filter((r) => {
    const d = r.task.dueDate
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    )
  }).length

  // ── Derived: Deal Health + Deal Gaps (batched) ─────────────────────────────
  // A single batch call fetches everything needed to score every open
  // lead and identify its gaps. Previously this loop issued ~6 queries
  // per lead × 500 leads = 3,000 DB round-trips per dashboard render;
  // the batch version does it in 4 queries flat regardless of size.
  const rhythmSnapshot = await getRhythmSnapshot(
    openLeads.map((l) => l.id),
    orgId,
  )

  const engagement = openLeads.map((lead) => {
    const entry = rhythmSnapshot.get(lead.id)
    // A lead missing from the snapshot was filtered out by the query
    // (deleted between reads or scoped out) — treat it as Critical with
    // the minimum score so it still appears in the "worst health" list.
    const score = entry?.engagementScore ?? 1
    const health = entry?.health ?? 'Critical'
    const gaps = entry?.gaps ?? []
    return { lead, score, health, gaps }
  })

  const healthSummary = engagement.reduce(
    (acc, e) => {
      if (e.health === 'Healthy') acc.healthy++
      else if (e.health === 'At Risk') acc.atRisk++
      else acc.critical++
      return acc
    },
    { healthy: 0, atRisk: 0, critical: 0 },
  )
  const worstHealth: DealHealthRow[] = engagement
    .slice()
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((e) => ({
      leadId: e.lead.id,
      leadName: `${e.lead.firstName} ${e.lead.lastName}`.trim(),
      engagementScore: e.score,
      health: e.health,
      dealValue: e.lead.dealValue ? Number(e.lead.dealValue) : null,
    }))

  const gapSummary = engagement.reduce(
    (acc, g) => {
      if (g.gaps.includes('no_recent_activity')) acc.noRecentActivity++
      if (g.gaps.includes('no_future_meeting')) acc.noFutureMeeting++
      if (g.gaps.includes('single_threaded')) acc.singleThreaded++
      return acc
    },
    { noRecentActivity: 0, noFutureMeeting: 0, singleThreaded: 0 },
  )
  const gapRows: DealGapRow[] = engagement
    .filter((g) => g.gaps.length > 0)
    .slice(0, 10)
    .map((g) => ({
      leadId: g.lead.id,
      leadName: `${g.lead.firstName} ${g.lead.lastName}`.trim(),
      gaps: g.gaps,
    }))

  // ── Derived: Team View (manager+ only) ─────────────────────────────────────
  const teamReps: TeamRepSummary[] = []
  if (isManagerOrAbove && teamMembers.length > 0) {
    // Pull open tasks for all team members in one query so we can rank them
    // without N round-trips to the database.
    const teamUserIds = teamMembers.map((m) => m.userId)
    const teamTasks = await db.task.findMany({
      where: { assigneeId: { in: teamUserIds }, isComplete: false },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            score: true,
            dealValue: true,
            lastActivityAt: true,
          },
        },
      },
    })

    const byUser = new Map<string, typeof teamTasks>()
    for (const t of teamTasks) {
      const bucket = byUser.get(t.assigneeId) ?? []
      bucket.push(t)
      byUser.set(t.assigneeId, bucket)
    }

    for (const m of teamMembers) {
      const tasks = byUser.get(m.userId) ?? []
      const ranked = tasks
        .map((t) => ({
          id: t.id,
          title: t.title,
          dueDate: t.dueDate,
          priorityScore: calculatePriorityScore({
            dueDate: t.dueDate,
            dealValue: t.lead.dealValue ? Number(t.lead.dealValue) : null,
            leadScore: t.lead.score ?? null,
            lastActivityAt: t.lead.lastActivityAt,
            priority: t.priority,
          }),
        }))
        .sort((a, b) => b.priorityScore - a.priorityScore)

      teamReps.push({
        userId: m.userId,
        name: m.name,
        overdueCount: ranked.filter((r) => r.dueDate.getTime() < nowMs).length,
        topUrgent: ranked.slice(0, 3).map((r) => ({
          id: r.id,
          title: r.title,
          priorityScore: r.priorityScore,
        })),
      })
    }
  }

  // ── Derived: Commit vs AI ──────────────────────────────────────────────────
  const commitBasisStatus = commit ? forecastBasisStatus(commit, 'OWNER') : 'missing'
  const teamCommitValue = commit && commitBasisStatus === 'verified' ? Number(commit.commitAmount) : null
  const risk =
    teamCommitValue == null
      ? null
      : assessForecastRisk(teamCommitValue, ownerForecastMetrics?.aiPredicted ?? 0)

  // ── Assemble tabs ──────────────────────────────────────────────────────────
  const activeTab = typeof params.tab === 'string' ? params.tab : undefined
  const items: DashboardTabItem[] = [
    {
      value: 'rhythm',
      label: "Today's Rhythm",
      content: (
        <TodaysRhythmPanel
          actions={rhythmActions}
          overdueCount={overdueCount}
          todayCount={todayCount}
          openCount={rankedMyTasks.length}
        />
      ),
    },
    {
      value: 'team',
      label: 'Team View',
      visible: isManagerOrAbove,
      content: <TeamViewPanel reps={teamReps} />,
    },
    {
      value: 'health',
      label: 'Deal Health',
      content: <DealHealthPanel leads={worstHealth} summary={healthSummary} />,
    },
    {
      value: 'gaps',
      label: 'Deal Gaps',
      content: <DealGapsPanel leads={gapRows} summary={gapSummary} />,
    },
    {
      value: 'forecast',
      label: 'Forecast',
      content: (
        <ForecastPanel
          totalPipeline={forecastMetrics.totalPipeline}
          weightedPipeline={forecastMetrics.weightedPipeline}
          aiPredicted={forecastMetrics.aiPredicted}
          winRate={winRate}
        />
      ),
    },
    {
      value: 'commit',
      label: 'Commit vs AI',
      visible: isManagerOrAbove,
      content: (
        <CommitVsAiPanel
          teamCommit={teamCommitValue}
          basisStatus={commitBasisStatus}
          aiPredicted={ownerForecastMetrics?.aiPredicted ?? 0}
          risk={risk}
          period={currentPeriod}
        />
      ),
    },
    {
      value: 'pipeline',
      label: 'Pipeline Metrics',
      content: <PipelineMetricsPanel report={metricsReport} />,
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Dashboard"
        description="Signals, forecasts and pipeline metrics for your organization."
        actions={
          canWrite ? (
            <Link href="/leads/new" className={buttonVariants({ size: 'lg' })}>
              <Plus className="size-4" aria-hidden="true" />
              New lead
            </Link>
          ) : undefined
        }
      />
      <NeedsCheckingSummary context={{ organizationId: orgId, userId }} canWrite={canWrite} />
      <DashboardTabs items={items} defaultValue={activeTab} />
    </div>
  )
}

/**
 * Parses the optional `from` / `to` URL query params into a date range.
 * Values outside YYYY-MM-DD are ignored (falls back to the service default).
 *
 * Date-only inputs (`YYYY-MM-DD`) are anchored to the server's local
 * timezone rather than parsed as UTC. `new Date('2026-01-01')` would
 * otherwise resolve to UTC midnight, which shifts the effective day in
 * every non-UTC timezone — a common source of "the range dropped a day"
 * bugs. Full ISO timestamps still round-trip through the native parser.
 */
function parseDateRange(
  params: Record<string, string | string[] | undefined>,
): { from?: Date; to?: Date } {
  const fromStr = typeof params.from === 'string' ? params.from : undefined
  const toStr = typeof params.to === 'string' ? params.to : undefined
  const out: { from?: Date; to?: Date } = {}
  if (fromStr) {
    const d = parseDateInput(fromStr, false)
    if (d) out.from = d
  }
  if (toStr) {
    const d = parseDateInput(toStr, true)
    if (d) out.to = d
  }
  return out
}

/**
 * Parses `YYYY-MM-DD` as local-time midnight (start of day) or
 * end-of-day, and leaves any other value to the native `Date` parser
 * so ISO timestamps still work.
 */
function parseDateInput(input: string, endOfDay: boolean): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input)
  if (match) {
    const y = Number(match[1])
    const m = Number(match[2]) - 1
    const day = Number(match[3])
    const d = endOfDay
      ? new Date(y, m, day, 23, 59, 59, 999)
      : new Date(y, m, day, 0, 0, 0, 0)
    if (Number.isNaN(d.getTime())) return undefined
    return d
  }
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return undefined
  if (endOfDay) d.setHours(23, 59, 59, 999)
  return d
}

/**
 * Resolves team members visible to the current user. For an OWNER/ADMIN
 * this is everyone in the organization; for a MANAGER it is the members
 * of the teams they manage (including sub-teams). MEMBER never reaches
 * this code path.
 */
async function resolveTeamMembers(
  userId: string,
  orgId: string,
  hierarchy: number,
): Promise<{ userId: string; name: string }[]> {
  // Load all org members first — the set we expose is a subset of these.
  const orgMembers = await prisma.organizationMember.findMany({
    where: { organizationId: orgId },
    include: { user: { select: { id: true, name: true } } },
  })

  if (hierarchy <= 1) {
    // OWNER / ADMIN: everyone in the org.
    return orgMembers
      .map((m) => ({
        userId: m.user.id,
        name: m.user.name ?? 'Unnamed user',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  // MANAGER: resolve accessible teams, then their members.
  const { getAccessibleTeamIds } = await import('@/server/services/teams')
  const accessibleTeamIds = await getAccessibleTeamIds(userId, orgId)
  if (accessibleTeamIds.length === 0) return []

  const teamMembers = await prisma.teamMember.findMany({
    where: { teamId: { in: accessibleTeamIds } },
    include: { user: { select: { id: true, name: true } } },
  })

  // Deduplicate (a user can belong to multiple teams).
  const seen = new Set<string>()
  const out: { userId: string; name: string }[] = []
  for (const m of teamMembers) {
    if (seen.has(m.user.id)) continue
    seen.add(m.user.id)
    out.push({
      userId: m.user.id,
      name: m.user.name ?? 'Unnamed user',
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
