import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { getLeadAccessFilter } from '@/server/services/access'
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs'
import { CadenceBuilder } from '@/components/cadences/cadence-builder'
import { EnrollmentList } from '@/components/cadences/enrollment-list'
import { EnrollDialog } from '@/components/cadences/enroll-dialog'
import {
  CadenceAnalyticsPanel,
} from '@/components/cadences/cadence-analytics'
import { StatusBadge } from '@/components/cadences/cadence-list'
import { CadenceSettings } from '@/components/cadences/cadence-settings'
import type {
  CadenceAnalytics,
  CadenceDetail,
  CadenceStep,
  EnrollmentListItem,
  EnrollmentStatus,
} from '@/hooks/use-cadences'
import type { EnrollDialogLead } from '@/components/cadences/enroll-dialog'

/**
 * Cadence detail page — Server Component with 4 tabs:
 *
 * 1. **Overview** — read/edit steps (CadenceBuilder)
 * 2. **People** — enrollments with pause/resume/exit actions
 * 3. **Analytics** — enrollment counts, completion rate, per-step metrics
 * 4. **Settings** — activate / archive / delete + metadata
 *
 * All four tabs are pre-rendered server-side so switching tabs never
 * triggers a new fetch. The mutations on each tab invalidate the relevant
 * TanStack Query caches and call `router.refresh()` so the Server
 * Component re-renders with fresh data.
 *
 * Validates: Requirements 6.1, 6.2, 6.5, 6.10, 32.1, 32.2, 32.3, 32.4, 32.5
 */
export default async function CadenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params
  const session = await requireSession()

  const canRead =
    hasPermission(session.dbUser, 'cadences:read')
    || hasPermission(session.dbUser, 'cadences:manage')
  const canManage = hasPermission(session.dbUser, 'cadences:manage')

  if (!canRead) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">Cadence</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view cadences in this organization.
        </p>
      </div>
    )
  }

  const db = createTenantPrisma(session.organizationId)
  const cadence = await db.cadence.findFirst({
    where: { id },
    include: {
      steps: { orderBy: { stepOrder: 'asc' } },
      _count: { select: { enrollments: true } },
    },
  })

  if (!cadence) {
    notFound()
  }

  // Load enrollments with lead summaries. The tenant middleware scopes by
  // organizationId, so leads referenced here already belong to the org.
  const enrollments = await db.cadenceEnrollment.findMany({
    where: { cadenceId: id },
    include: {
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          companyName: true,
        },
      },
    },
    orderBy: [{ status: 'asc' }, { enrolledAt: 'desc' }],
  })

  // Compute analytics counts server-side once so the Analytics tab has
  // consistent initial data and the `/api/cadences/[id]/analytics` endpoint
  // can take over on refresh.
  const counts = enrollments.reduce(
    (acc, e) => {
      acc.total += 1
      acc[e.status as EnrollmentStatus] += 1
      return acc
    },
    { total: 0, ACTIVE: 0, PAUSED: 0, COMPLETED: 0, EXITED: 0 },
  )
  const terminal = counts.COMPLETED + counts.EXITED
  const completionRate =
    terminal > 0 ? Math.round((counts.COMPLETED / terminal) * 100) : 0

  const initialAnalytics: CadenceAnalytics = {
    cadenceId: cadence.id,
    cadenceName: cadence.name,
    cadenceStatus: cadence.status as CadenceAnalytics['cadenceStatus'],
    totalEnrollments: counts.total,
    activeEnrollments: counts.ACTIVE,
    completedEnrollments: counts.COMPLETED,
    exitedEnrollments: counts.EXITED,
    pausedEnrollments: counts.PAUSED,
    completionRate,
  }

  const serializedSteps: CadenceStep[] = cadence.steps.map((s) => ({
    id: s.id,
    cadenceId: s.cadenceId,
    stepOrder: s.stepOrder,
    actionType: s.actionType as CadenceStep['actionType'],
    delayHours: s.delayHours,
    emailSubject: s.emailSubject,
    emailBody: s.emailBody,
    taskTitle: s.taskTitle,
    taskDescription: s.taskDescription,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }))

  const serializedEnrollments: EnrollmentListItem[] = enrollments.map(
    (e) => ({
      id: e.id,
      cadenceId: e.cadenceId,
      leadId: e.leadId,
      enrolledById: e.enrolledById,
      status: e.status as EnrollmentStatus,
      currentStepOrder: e.currentStepOrder,
      exitReason: e.exitReason,
      enrolledAt: e.enrolledAt.toISOString(),
      completedAt: e.completedAt ? e.completedAt.toISOString() : null,
      updatedAt: e.updatedAt.toISOString(),
      lead: e.lead
        ? {
            id: e.lead.id,
            firstName: e.lead.firstName,
            lastName: e.lead.lastName,
            email: e.lead.email,
            companyName: e.lead.companyName,
          }
        : null,
    }),
  )

  const cadenceDetail: CadenceDetail = {
    id: cadence.id,
    name: cadence.name,
    status: cadence.status as CadenceDetail['status'],
    createdById: cadence.createdById,
    createdAt: cadence.createdAt.toISOString(),
    updatedAt: cadence.updatedAt.toISOString(),
    steps: serializedSteps,
    _count: { enrollments: cadence._count.enrollments },
  }

  // Resolve leads eligible for enrollment from this page using the same
  // RBAC access filter applied elsewhere. We exclude leads with an active
  // enrollment in this cadence to keep the picker honest.
  const leadOptions = canManage
    ? await resolveEnrollableLeads(session.dbUser, session.organizationId, id)
    : []

  const isArchived = cadence.status === 'ARCHIVED'

  return (
    <div className="flex flex-col gap-5">
      <nav className="text-sm">
        <Link
          href="/cadences"
          className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span>Back to cadences</span>
        </Link>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {cadence.name}
            </h1>
            <StatusBadge status={cadenceDetail.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {serializedSteps.length} step
            {serializedSteps.length === 1 ? '' : 's'} ·{' '}
            {counts.total} enrolled
          </p>
        </div>
        <EnrollDialog
          cadenceId={cadence.id}
          leads={leadOptions}
          canEnroll={canManage && cadenceDetail.status === 'ACTIVE'}
        />
      </header>

      <DashboardTabs
        items={[
          {
            value: 'overview',
            label: 'Overview',
            content: (
              <CadenceBuilder
                cadenceId={cadence.id}
                initialSteps={serializedSteps}
                readOnly={!canManage || isArchived}
              />
            ),
          },
          {
            value: 'people',
            label: `People${
              counts.total > 0 ? ` (${counts.total})` : ''
            }`,
            content: (
              <EnrollmentList
                cadenceId={cadence.id}
                initialEnrollments={serializedEnrollments}
              />
            ),
          },
          {
            value: 'analytics',
            label: 'Analytics',
            content: (
              <CadenceAnalyticsPanel
                cadenceId={cadence.id}
                initialAnalytics={initialAnalytics}
                steps={serializedSteps}
                enrollments={serializedEnrollments}
              />
            ),
          },
          {
            value: 'settings',
            label: 'Settings',
            content: (
              <CadenceSettings
                cadence={cadenceDetail}
                activeEnrollmentCount={counts.ACTIVE}
                canManage={canManage}
              />
            ),
          },
        ]}
      />
    </div>
  )
}

/**
 * Resolve leads eligible for enrollment. Applies the same RBAC access
 * filter used everywhere else, then excludes leads already actively
 * enrolled in this cadence.
 */
async function resolveEnrollableLeads(
  user: Awaited<ReturnType<typeof requireSession>>['dbUser'],
  orgId: string,
  cadenceId: string,
): Promise<EnrollDialogLead[]> {
  const db = createTenantPrisma(orgId)
  const accessFilter = await getLeadAccessFilter(user, orgId)

  const activeEnrollments = await db.cadenceEnrollment.findMany({
    where: { cadenceId, status: 'ACTIVE' },
    select: { leadId: true },
  })
  const excludeIds = new Set(activeEnrollments.map((e) => e.leadId))

  const leads = await db.lead.findMany({
    where: {
      ...accessFilter,
      ...(excludeIds.size > 0 ? { id: { notIn: [...excludeIds] } } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      companyName: true,
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 200,
  })

  return leads.map((lead) => ({
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    companyName: lead.companyName,
  }))
}
