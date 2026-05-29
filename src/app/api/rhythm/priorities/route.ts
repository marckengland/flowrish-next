import { NextResponse } from 'next/server'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { getLeadAccessFilter } from '@/server/services/access'
import { calculatePriorityScore } from '@/server/services/rhythm'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/rhythm/priorities — Org-wide prioritized actions feed.
 *
 * Returns a sorted list of pending actions (open tasks today/overdue
 * plus stalled cadence steps) ranked by `calculatePriorityScore`. The
 * Rhythm dashboard renders this as a "what to do next" queue.
 *
 * The list is intentionally small (~30 items) so reps see the highest-
 * leverage work and don't have to scroll past dozens of stale tasks.
 *
 * Validates: Requirements 9.1, 9.2
 */

interface PrioritizedAction {
  id: string
  type: 'task' | 'cadence_step'
  title: string
  leadId: string
  leadName: string
  companyName: string | null
  dueDate: string | null
  priorityScore: number
  isOverdue: boolean
  signals: Array<{ type: string; description: string }>
}

export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const accessFilter = await getLeadAccessFilter(
      session.dbUser,
      session.organizationId,
    )

    const db = createTenantPrisma(session.organizationId)
    const now = new Date()

    // Open tasks the caller can see, scoped through the lead access
    // filter so MEMBERs only see their own leads' tasks.
    const tasks = await db.task.findMany({
      where: {
        isComplete: false,
        lead: {
          ...accessFilter,
          deletedAt: null,
          isClosed: false,
        },
      },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            score: true,
            dealValue: true,
            lastActivityAt: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
      take: 100,
    })

    const actions: PrioritizedAction[] = tasks.map((task) => {
      const dealValue =
        task.lead.dealValue === null ? null : Number(task.lead.dealValue)
      const score = calculatePriorityScore({
        dueDate: task.dueDate,
        dealValue,
        leadScore: task.lead.score,
        lastActivityAt: task.lead.lastActivityAt,
        priority: task.priority,
      })

      const signals: PrioritizedAction['signals'] = []
      const isOverdue = task.dueDate.getTime() < now.getTime()
      if (isOverdue) {
        signals.push({ type: 'overdue', description: 'Overdue' })
      }
      if (dealValue !== null && dealValue > 0) {
        signals.push({
          type: 'deal_value',
          description: `$${dealValue.toLocaleString()}`,
        })
      }
      if (task.lead.score >= 60) {
        signals.push({
          type: 'lead_score',
          description: `Lead score ${task.lead.score}`,
        })
      }

      return {
        id: task.id,
        type: 'task',
        title: task.title,
        leadId: task.lead.id,
        leadName: `${task.lead.firstName} ${task.lead.lastName}`.trim(),
        companyName: task.lead.companyName,
        dueDate: task.dueDate.toISOString(),
        priorityScore: score,
        isOverdue,
        signals,
      }
    })

    // Sort by priority score descending; the take(100) above guarantees
    // an upper bound on work, then we slice to the most useful 30.
    actions.sort((a, b) => b.priorityScore - a.priorityScore)

    return NextResponse.json({ data: actions.slice(0, 30) })
  } catch (error) {
    return errorResponse(error)
  }
}
