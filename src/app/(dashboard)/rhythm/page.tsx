import { redirect } from 'next/navigation'

import {
  DealHealth,
  type DealHealthRow,
} from '@/components/rhythm/deal-health'
import {
  PriorityList,
  type PriorityActionRow,
} from '@/components/rhythm/priority-list'
import {
  TeamRhythm,
  type TeamRhythmRepRow,
  type TeamRhythmUrgentAction,
} from '@/components/rhythm/team-rhythm'
import { requireSession } from '@/server/auth/session'
import { prisma } from '@/server/db/client'
import { createTenantPrisma } from '@/server/db/middleware'
import { getAccessibleTeamIds } from '@/server/services/teams'
import {
  calculateDealEngagementScore,
  calculatePriorityScore,
  classifyDealHealth,
  identifyDealGaps,
} from '@/server/services/rhythm'

// Leads processed per render for deal health + gaps. A safety cap keeps
// the page responsive on orgs with very large open pipelines; the numbers
// shown in the summary panels reflect the sampled set.
const DEAL_HEALTH_SAMPLE_SIZE = 500
// Top-N deals surfaced in the "Deals that need attention" list.
const DEAL_HEALTH_VISIBLE_COUNT = 10

/**
 * Rhythm dashboard page.
 *
 * A Server Component that:
 * 1. Ranks the current user's open tasks by priority score so they can
 *    execute the highest-impact actions first (Requirements 9.1, 9.2).
 * 2. For managers, aggregates signals across their direct reports with
 *    overdue counts and each rep's top 3 urgent actions (Requirement 9.3).
 * 3. Surfaces a deal-health snapshot with engagement scores, health
 *    classification, and structural gap detection (Requirements 9.4–9.6).
 *
 * All scoring is performed on the server via `@/server/services/rhythm`
 * and queries are tenant-scoped via `createTenantPrisma`.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */
export default async function RhythmPage(): Promise<React.JSX.Element> {
  const session = await requireSession()
  // Layout already redirects unauthenticated users; keep this guard so the
  // page can be reasoned about in isolation and to narrow types.
  if (!session) redirect('/login')

  const orgId = session.organizationId
  const userId = session.dbUser.id

  // ── Role detection (lowest hierarchy number wins across memberships) ──────
  const hierarchy = session.dbUser.teamMemberships.length
    ? Math.min(...session.dbUser.teamMemberships.map((m) => m.role.hierarchy))
    : Infinity
  const isManagerOrAbove = hierarchy <= 2

  const db = createTenantPrisma(orgId)
  const now = new Date()

  // ── Fetch the current user's pending actions ──────────────────────────────
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
          currency: true,
          lastActivityAt: true,
        },
      },
    },
    orderBy: { dueDate: 'asc' },
  })

  // ── Fetch open leads for deal health / gap analysis ──────────────────────
  const openLeadsPromise = db.lead.findMany({
    where: { isClosed: false, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dealValue: true,
      currency: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: DEAL_HEALTH_SAMPLE_SIZE,
  })

  // ── Resolve team members for manager view ─────────────────────────────────
  const teamMembersPromise: Promise<
    { userId: string; name: string; email: string | null }[]
  > = isManagerOrAbove
    ? resolveTeamMembers(userId, orgId, hierarchy)
    : Promise.resolve([])

  const [myTasks, openLeads, teamMembers] = await Promise.all([
    myTasksPromise,
    openLeadsPromise,
    teamMembersPromise,
  ])

  // ── Priority list (my actions) ────────────────────────────────────────────
  const priorityActions: PriorityActionRow[] = myTasks
    .map((t) => {
      const dealValue = t.lead.dealValue ? Number(t.lead.dealValue) : null
      const score = calculatePriorityScore({
        dueDate: t.dueDate,
        dealValue,
        leadScore: t.lead.score ?? null,
        lastActivityAt: t.lead.lastActivityAt,
        priority: t.priority,
      })
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        dueDate: t.dueDate,
        priorityScore: score,
        priority: t.priority,
        isOverdue: t.dueDate.getTime() < now.getTime(),
        leadId: t.lead.id,
        leadName: `${t.lead.firstName} ${t.lead.lastName}`.trim(),
        leadScore: t.lead.score ?? null,
        dealValue,
        currency: t.lead.currency ?? 'USD',
      }
    })
    .sort((a, b) => b.priorityScore - a.priorityScore)

  // ── Team view (manager-only) ──────────────────────────────────────────────
  const teamReps: TeamRhythmRepRow[] = []
  if (isManagerOrAbove && teamMembers.length > 0) {
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
    for (const task of teamTasks) {
      const bucket = byUser.get(task.assigneeId) ?? []
      bucket.push(task)
      byUser.set(task.assigneeId, bucket)
    }

    for (const member of teamMembers) {
      const tasks = byUser.get(member.userId) ?? []
      const ranked = tasks
        .map((t) => {
          const dealValue = t.lead.dealValue ? Number(t.lead.dealValue) : null
          const score = calculatePriorityScore({
            dueDate: t.dueDate,
            dealValue,
            leadScore: t.lead.score ?? null,
            lastActivityAt: t.lead.lastActivityAt,
            priority: t.priority,
          })
          return {
            id: t.id,
            title: t.title,
            priorityScore: score,
            leadId: t.lead.id,
            leadName: `${t.lead.firstName} ${t.lead.lastName}`.trim(),
            isOverdue: t.dueDate.getTime() < now.getTime(),
          } satisfies TeamRhythmUrgentAction
        })
        .sort((a, b) => b.priorityScore - a.priorityScore)

      teamReps.push({
        userId: member.userId,
        name: member.name,
        email: member.email,
        openActionCount: ranked.length,
        overdueCount: ranked.filter((a) => a.isOverdue).length,
        topUrgent: ranked.slice(0, 3),
      })
    }

    teamReps.sort((a, b) => b.overdueCount - a.overdueCount)
  }

  // ── Deal health / gap analysis ────────────────────────────────────────────
  const engagement = await Promise.all(
    openLeads.map(async (lead) => {
      const [score, gaps] = await Promise.all([
        calculateDealEngagementScore(lead.id, orgId),
        identifyDealGaps(lead.id, orgId),
      ])
      return {
        lead,
        score,
        health: classifyDealHealth(score),
        gaps,
      }
    }),
  )

  const healthSummary = engagement.reduce(
    (acc, e) => {
      if (e.health === 'Healthy') acc.healthy++
      else if (e.health === 'At Risk') acc.atRisk++
      else acc.critical++
      return acc
    },
    { healthy: 0, atRisk: 0, critical: 0 },
  )

  const gapSummary = engagement.reduce(
    (acc, e) => {
      if (e.gaps.includes('no_recent_activity')) acc.noRecentActivity++
      if (e.gaps.includes('no_future_meeting')) acc.noFutureMeeting++
      if (e.gaps.includes('single_threaded')) acc.singleThreaded++
      return acc
    },
    { noRecentActivity: 0, noFutureMeeting: 0, singleThreaded: 0 },
  )

  const dealHealthRows: DealHealthRow[] = engagement
    .slice()
    .sort((a, b) => a.score - b.score)
    .slice(0, DEAL_HEALTH_VISIBLE_COUNT)
    .map((e) => ({
      leadId: e.lead.id,
      leadName: `${e.lead.firstName} ${e.lead.lastName}`.trim(),
      engagementScore: e.score,
      health: e.health,
      dealValue: e.lead.dealValue ? Number(e.lead.dealValue) : null,
      currency: e.lead.currency ?? 'USD',
      gaps: e.gaps,
    }))

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Rhythm</h1>
        <p className="text-sm text-muted-foreground">
          Signal-based prioritization for the actions that move deals today.
        </p>
      </header>

      <PriorityList actions={priorityActions} />

      {isManagerOrAbove ? (
        <section aria-labelledby="team-rhythm-section" className="flex flex-col gap-3">
          <div>
            <h2
              id="team-rhythm-section"
              className="text-lg font-semibold tracking-tight"
            >
              Team rhythm
            </h2>
            <p className="text-sm text-muted-foreground">
              Overdue counts and top 3 urgent actions per rep.
            </p>
          </div>
          <TeamRhythm reps={teamReps} />
        </section>
      ) : null}

      <section aria-labelledby="deal-health-section" className="flex flex-col gap-3">
        <div>
          <h2
            id="deal-health-section"
            className="text-lg font-semibold tracking-tight"
          >
            Deal health
          </h2>
          <p className="text-sm text-muted-foreground">
            Engagement scores, health classification, and gap signals for your
            open deals.
          </p>
        </div>
        <DealHealth
          leads={dealHealthRows}
          summary={healthSummary}
          gapSummary={gapSummary}
        />
      </section>
    </div>
  )
}

/**
 * Resolves team members visible to the current user for the manager view.
 * OWNER/ADMIN see the whole org; MANAGER sees members of accessible teams
 * (direct + sub-teams); MEMBER never calls this function.
 */
async function resolveTeamMembers(
  userId: string,
  orgId: string,
  hierarchy: number,
): Promise<{ userId: string; name: string; email: string | null }[]> {
  if (hierarchy <= 1) {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id: true, name: true, email: true } } },
    })
    return members
      .map((m) => ({
        userId: m.user.id,
        name: m.user.name?.trim() || m.user.email,
        email: m.user.email,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  const accessibleTeamIds = await getAccessibleTeamIds(userId, orgId)
  if (accessibleTeamIds.length === 0) return []

  const teamMembers = await prisma.teamMember.findMany({
    where: { teamId: { in: accessibleTeamIds } },
    include: { user: { select: { id: true, name: true, email: true } } },
  })

  const seen = new Set<string>()
  const out: { userId: string; name: string; email: string | null }[] = []
  for (const m of teamMembers) {
    if (seen.has(m.user.id)) continue
    seen.add(m.user.id)
    out.push({
      userId: m.user.id,
      name: m.user.name?.trim() || m.user.email,
      email: m.user.email,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
