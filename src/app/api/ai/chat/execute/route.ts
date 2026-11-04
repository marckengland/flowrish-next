import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { executeChatAction, type ChatAction } from '@/server/services/ai'
import { errorResponse } from '@/lib/errors'
import { createTaskFromProposal } from '@/server/services/task-access'

/**
 * POST /api/ai/chat/execute — Performs an AI-proposed action after
 * the user has confirmed it (or auto-confirm is on).
 *
 * Body: `{ action: ChatAction }` — see `server/services/ai.ts` for the
 * supported action shapes. Unknown action types are rejected by the
 * Zod schema below; the executor itself also re-validates so the API
 * layer and the service stay in sync.
 *
 * Permissions: every supported action mutates lead/task/cadence data,
 * so we require `leads:write`. The individual services enforce
 * fine-grained ownership (e.g. assignee filters) as usual.
 *
 * Validates: Requirements 8.3
 */

const navigateActionSchema = z.object({
  type: z.literal('navigate'),
  description: z.string(),
  params: z.object({ path: z.string().startsWith('/') }),
})

const createLeadActionSchema = z.object({
  type: z.literal('create_lead'),
  description: z.string(),
  params: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
    companyName: z.string().optional(),
    leadStatus: z.string().optional(),
    tier: z.string().optional(),
    dealValue: z.number().optional(),
  }),
})

const createTaskActionSchema = z.object({
  type: z.literal('create_task'),
  description: z.string(),
  params: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    dueDate: z.string().optional(),
    leadId: z.string().uuid().optional(),
    assigneeId: z.string().uuid().optional(),
  }),
})

const updateLeadStatusActionSchema = z.object({
  type: z.literal('update_lead_status'),
  description: z.string(),
  params: z.object({
    leadId: z.string().uuid(),
    leadStatus: z.string().min(1),
  }),
})

const updateLeadTierActionSchema = z.object({
  type: z.literal('update_lead_tier'),
  description: z.string(),
  params: z.object({
    leadId: z.string().uuid(),
    tier: z.string().min(1),
  }),
})

const enrollInCadenceActionSchema = z.object({
  type: z.literal('enroll_in_cadence'),
  description: z.string(),
  params: z.object({
    cadenceId: z.string().uuid(),
    leadId: z.string().uuid(),
  }),
})

const createCadenceActionSchema = z.object({
  type: z.literal('create_cadence'),
  description: z.string(),
  params: z.object({
    name: z.string().min(1),
    steps: z
      .array(
        z.object({
          actionType: z.enum(['EMAIL', 'CALL', 'LINKEDIN', 'MANUAL_TASK']),
          delayHours: z.number().int().min(0).optional(),
          subject: z.string().optional(),
          body: z.string().optional(),
          taskTitle: z.string().optional(),
          taskDescription: z.string().optional(),
        }),
      )
      .min(1, 'A cadence needs at least one step'),
  }),
})

const actionSchema = z.discriminatedUnion('type', [
  navigateActionSchema,
  createLeadActionSchema,
  createTaskActionSchema,
  updateLeadStatusActionSchema,
  updateLeadTierActionSchema,
  enrollInCadenceActionSchema,
  createCadenceActionSchema,
])

const bodySchema = z.object({ action: actionSchema })

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const body = await request.json()
    const { action } = bodySchema.parse(body)

    // Creating a cadence is more privileged than the lead/task actions,
    // so require the same permission the manual cadence builder does.
    if (action.type === 'create_cadence') {
      requirePermission(session.dbUser, 'cadences:manage')
    }

    if (action.type === 'create_task') {
      const task = await createTaskFromProposal(session, action.params)
      return NextResponse.json({
        data: {
          success: true,
          message: 'Task created.',
          data: { taskId: task.id, leadId: task.leadId },
        },
      })
    }

    const result = await executeChatAction(
      action as ChatAction,
      session.dbUser.id,
      session.organizationId,
    )

    return NextResponse.json({ data: result })
  } catch (error) {
    return errorResponse(error)
  }
}
