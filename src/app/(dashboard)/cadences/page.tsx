import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { PageHeader } from '@/components/layout/page-header'
import { CadenceList } from '@/components/cadences/cadence-list'
import type {
  CadenceListItem,
  CadencesPage,
} from '@/hooks/use-cadences'

/**
 * Cadences list page — Server Component.
 *
 * Responsibilities:
 * 1. Require an authenticated session plus either `cadences:read` or
 *    `cadences:manage` permission (either lets the user list cadences;
 *    only `cadences:manage` enables creation and destructive actions).
 * 2. Pre-fetch the first page of cadences via the tenant-scoped Prisma
 *    client so the list paints immediately and TanStack Query can take
 *    over when filters change.
 * 3. Surface per-cadence metrics: step count (length of `steps`) and
 *    total enrollments (`_count.enrollments`). Completion rate is shown
 *    on the detail page where per-status counts are available.
 *
 * Validates: Requirements 6.1, 32.1, 32.5
 */
export default async function CadencesPage(): Promise<React.JSX.Element> {
  const session = await requireSession()

  const canRead =
    hasPermission(session.dbUser, 'cadences:read')
    || hasPermission(session.dbUser, 'cadences:manage')
  const canManage = hasPermission(session.dbUser, 'cadences:manage')

  if (!canRead) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">Cadences</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view cadences in this organization.
        </p>
      </div>
    )
  }

  const db = createTenantPrisma(session.organizationId)
  const pageSize = 50
  const [cadences, total] = await Promise.all([
    db.cadence.findMany({
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
    }),
    db.cadence.count(),
  ])

  const initialData: CadencesPage = {
    data: cadences.map(toCadenceListItem),
    pagination: {
      page: 1,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Cadences"
        description="Automated multi-step outreach sequences"
      />

      <CadenceList initialData={initialData} canManage={canManage} />
    </div>
  )
}

/**
 * Normalise a Prisma Cadence (with steps + enrollment count) to the JSON-
 * serialisable shape the list component consumes. Matches the wire format
 * the `/api/cadences` route returns so TanStack Query's cache updates
 * stay shape-compatible.
 */
function toCadenceListItem(
  cadence: {
    id: string
    name: string
    status: string
    createdById: string
    createdAt: Date
    updatedAt: Date
    steps: Array<{
      id: string
      cadenceId: string
      stepOrder: number
      actionType: string
      delayHours: number
      emailSubject: string | null
      emailBody: string | null
      taskTitle: string | null
      taskDescription: string | null
      startNewThread: boolean
      createdAt: Date
      updatedAt: Date
    }>
    _count: { enrollments: number }
  },
): CadenceListItem {
  return {
    id: cadence.id,
    name: cadence.name,
    status: cadence.status as CadenceListItem['status'],
    createdById: cadence.createdById,
    createdAt: cadence.createdAt.toISOString(),
    updatedAt: cadence.updatedAt.toISOString(),
    steps: cadence.steps.map((s) => ({
      id: s.id,
      cadenceId: s.cadenceId,
      stepOrder: s.stepOrder,
      actionType: s.actionType as CadenceListItem['steps'][number]['actionType'],
      delayHours: s.delayHours,
      emailSubject: s.emailSubject,
      emailBody: s.emailBody,
      taskTitle: s.taskTitle,
      taskDescription: s.taskDescription,
      startNewThread: s.startNewThread,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    _count: { enrollments: cadence._count.enrollments },
  }
}
