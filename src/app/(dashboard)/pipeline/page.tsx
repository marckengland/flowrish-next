import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from '@/server/services/access'
import { getLeads } from '@/server/services/leads'
import { getOrCreateDefaultPipeline } from '@/server/services/pipeline'
import {
  KanbanBoard,
  type KanbanStage,
} from '@/components/pipeline/kanban-board'
import type { LeadListItem } from '@/hooks/use-leads'

/**
 * Pipeline Kanban page — Server Component.
 *
 * Responsibilities:
 * 1. Require an authenticated session and `leads:read` permission.
 * 2. Resolve the organization's default pipeline with its stages.
 * 3. Fetch all accessible leads via the RBAC-scoped leads service so the
 *    board can paint immediately. Members see only their assigned leads;
 *    managers see team + sub-team leads; admins/owners see all org leads.
 *    An empty board still renders every stage column (Requirement 17.4).
 * 4. Gate drag-and-drop moves on `leads:write` so view-only roles see a
 *    read-only board.
 *
 * The board itself (client component) handles the TanStack Query cache,
 * drag state (Zustand `kanban` store), and the `/api/leads/[id]/move`
 * mutation that creates the StageTransition + updates `stageId`.
 *
 * Validates: Requirements 17.1, 17.2, 17.4, 17.5, 3.2, 3.3, 3.4, 3.5, 26.3, 26.4
 */
export default async function PipelinePage(): Promise<React.JSX.Element> {
  const session = await requireSession()

  if (!hasPermission(session.dbUser, 'leads:read')) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view the pipeline in this
          organization.
        </p>
      </div>
    )
  }

  const canMove = hasPermission(session.dbUser, 'leads:write')

  // Resolve (or auto-create) the default pipeline. The service returns
  // stages ordered ascending so we can hand them straight to the board.
  const pipeline = await getOrCreateDefaultPipeline(session.organizationId)

  const stages: KanbanStage[] = pipeline.stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      isClosedWon: s.isClosedWon,
      isClosedLost: s.isClosedLost,
    }))

  // Fetch leads through the RBAC-scoped service. A pageSize of 200 is a
  // pragmatic upper bound for the Kanban view — larger orgs can layer on
  // virtualization later (Requirement 17.4 doesn't impose a hard limit).
  const accessFilter = await getLeadAccessFilter(session.dbUser)
  const firstPage = await getLeads(
    {},
    { page: 1, pageSize: 200 },
    accessFilter,
    session.organizationId,
  )

  const initialLeads: LeadListItem[] = firstPage.leads.map(toLeadListItem)

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {pipeline.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {canMove
            ? 'Drag leads between stages to update their pipeline position.'
            : 'Read-only view of the organization pipeline.'}
        </p>
      </header>

      <KanbanBoard
        stages={stages}
        initialLeads={initialLeads}
        totalLeads={firstPage.pagination.total}
        canMove={canMove}
      />
    </div>
  )
}

/**
 * Normalizes a Prisma Lead (with stage + assignedUser) into the
 * JSON-serializable shape the client hooks expect. Matches the helper in
 * the leads page (`(dashboard)/leads/page.tsx`) so both views serialize
 * leads identically and share cache entries.
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
