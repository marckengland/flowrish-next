import Link from 'next/link'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { LeadFilters, type FilterOption } from '@/components/leads/lead-filters'
import { LeadTable } from '@/components/leads/lead-table'
import { prisma } from '@/server/db/client'
import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from '@/server/services/access'
import { getLeads } from '@/server/services/leads'
import { getOrCreateDefaultPipeline } from '@/server/services/pipeline'
import type { LeadListItem, LeadsPage } from '@/hooks/use-leads'

/**
 * Leads list page — Server Component.
 *
 * Responsibilities:
 * 1. Require an authenticated session and `leads:read` permission.
 * 2. Resolve filter option datasets (pipeline stages, assignable users)
 *    server-side so the filter panel doesn't have to round-trip.
 * 3. Pre-fetch the first page of leads via the RBAC-scoped service so
 *    the table paints immediately and TanStack Query can take over on
 *    subsequent filter changes.
 *
 * Client filter UI state lives in the Zustand `filters` store. The
 * `LeadTable` reads that slice and queries `/api/leads` via TanStack
 * Query whenever it changes.
 *
 * Validates: Requirements 4.4, 4.6, 3.7, 26.3, 26.4
 */
export default async function LeadsPage(): Promise<React.JSX.Element> {
  const session = await requireSession()

  if (!hasPermission(session.dbUser, 'leads:read')) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">Leads</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view leads in this organization.
        </p>
      </div>
    )
  }

  const canWrite = hasPermission(session.dbUser, 'leads:write')

  // Resolve filter option datasets.
  const [pipeline, members] = await Promise.all([
    getOrCreateDefaultPipeline(session.organizationId),
    prisma.organizationMember.findMany({
      where: { organizationId: session.organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
  ])

  const stageOptions: FilterOption[] = pipeline.stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ value: s.id, label: s.name }))

  const assigneeOptions: FilterOption[] = members.map((m) => ({
    value: m.userId,
    label: m.user.name?.trim() || m.user.email,
  }))

  // Pre-fetch the first page through the RBAC-scoped service.
  const accessFilter = await getLeadAccessFilter(session.dbUser, session.organizationId)
  const firstPage = await getLeads(
    {},
    { page: 1, pageSize: 20 },
    accessFilter,
    session.organizationId,
  )

  const initialData: LeadsPage = {
    data: firstPage.leads.map(toLeadListItem),
    pagination: firstPage.pagination,
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Track prospects, filter by stage or owner, and open a lead to see
            its full timeline.
          </p>
        </div>
        {canWrite && (
          <Button
            render={<Link href="/leads/new" />}
            nativeButton={false}
            size="sm"
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>New lead</span>
          </Button>
        )}
      </header>

      <LeadFilters stages={stageOptions} assignees={assigneeOptions} />

      <LeadTable initialData={initialData} page={1} pageSize={20} />
    </div>
  )
}

/**
 * Normalizes a Prisma Lead (with stage + assignedUser) into the
 * JSON-serializable shape `LeadTable` expects. Decimal values come back
 * as Prisma's `Decimal` objects and Dates as real `Date`s, so we convert
 * both to strings the same way Next's JSON serializer would for the
 * client transition.
 */
function toLeadListItem(
  lead: Awaited<ReturnType<typeof getLeads>>['leads'][number],
): LeadListItem {
  return {
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    title: lead.title,
    dealValue: lead.dealValue === null ? null : String(lead.dealValue),
    currency: lead.currency,
    score: lead.score,
    leadStatus: lead.leadStatus,
    tier: lead.tier,
    companyName: lead.companyName,
    stageId: lead.stageId,
    assignedUserId: lead.assignedUserId,
    lastActivityAt: lead.lastActivityAt
      ? lead.lastActivityAt.toISOString()
      : null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    stage: lead.stage
      ? {
          id: lead.stage.id,
          name: lead.stage.name,
          order: lead.stage.order,
          isClosedWon: lead.stage.isClosedWon,
          isClosedLost: lead.stage.isClosedLost,
        }
      : undefined,
    assignedUser: lead.assignedUser
      ? {
          id: lead.assignedUser.id,
          name: lead.assignedUser.name,
          email: lead.assignedUser.email,
        }
      : null,
  }
}
