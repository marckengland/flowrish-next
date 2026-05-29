import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { prisma } from '@/server/db/client'
import {
  cadenceCreateSchema,
  stepCreateSchema,
  stepUpdateSchema,
} from '@/lib/validators/cadences'
import { AppError } from '@/lib/errors'

/**
 * Valid exit reasons for cadence enrollments.
 */
export type ExitReason =
  | 'reply_received'
  | 'meeting_booked'
  | 'cadence_archived'
  | 'lead_converted'
  | 'manual'

/**
 * Cadence service — handles cadence lifecycle management including
 * creation, activation, archiving, and step management.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.10
 */

/**
 * Creates a new cadence with status DRAFT.
 *
 * - Validates input with Zod (requires name)
 * - Always starts in DRAFT status regardless of input
 *
 * Validates: Requirement 6.1
 *
 * @param data - The cadence creation data (name, optional description)
 * @param userId - The user creating the cadence
 * @param orgId - The organization ID
 * @returns The created cadence
 */
export async function createCadence(
  data: unknown,
  userId: string,
  orgId: string,
) {
  if (!userId) {
    throw new AppError('VALIDATION_ERROR', 'User ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const validated = cadenceCreateSchema.parse(data)

  const db = createTenantPrisma(orgId)

  const cadence = await db.cadence.create({
    data: tenantData({
      name: validated.name,
      status: 'DRAFT',
      createdById: userId,
    }),
    include: { steps: true },
  })

  return cadence
}

/**
 * Activates a cadence, transitioning it from DRAFT to ACTIVE.
 *
 * - Requires at least one step to exist before activation
 * - Only DRAFT cadences can be activated
 *
 * Validates: Requirement 6.2
 *
 * @param id - The cadence ID to activate
 * @param orgId - The organization ID
 * @returns The activated cadence
 */
export async function activateCadence(id: string, orgId: string) {
  if (!id) {
    throw new AppError('VALIDATION_ERROR', 'Cadence ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  const cadence = await db.cadence.findFirst({
    where: { id },
    include: { steps: true },
  })

  if (!cadence) {
    throw new AppError('NOT_FOUND', 'Cadence not found', 404)
  }

  if (cadence.status === 'ACTIVE') {
    throw new AppError('INVALID_STATE', 'Cadence is already active', 400)
  }

  if (cadence.status === 'ARCHIVED') {
    throw new AppError('INVALID_STATE', 'Cannot activate an archived cadence', 400)
  }

  // Require at least one step
  if (cadence.steps.length === 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Cadence must have at least one step before activation',
      400,
    )
  }

  const activated = await db.cadence.update({
    where: { id },
    data: { status: 'ACTIVE' },
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
  })

  return activated
}

/**
 * Archives a cadence, exiting all ACTIVE enrollments with reason "cadence_archived".
 *
 * - Sets cadence status to ARCHIVED
 * - Exits all ACTIVE enrollments with exitReason "cadence_archived"
 * - Once archived, step modifications are rejected
 *
 * Validates: Requirement 6.3
 *
 * @param id - The cadence ID to archive
 * @param orgId - The organization ID
 * @returns The archived cadence
 */
export async function archiveCadence(id: string, orgId: string) {
  if (!id) {
    throw new AppError('VALIDATION_ERROR', 'Cadence ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  const cadence = await db.cadence.findFirst({
    where: { id },
  })

  if (!cadence) {
    throw new AppError('NOT_FOUND', 'Cadence not found', 404)
  }

  if (cadence.status === 'ARCHIVED') {
    throw new AppError('INVALID_STATE', 'Cadence is already archived', 400)
  }

  // Exit all ACTIVE enrollments with reason "cadence_archived"
  await db.cadenceEnrollment.updateMany({
    where: {
      cadenceId: id,
      status: 'ACTIVE',
    },
    data: {
      status: 'EXITED',
      exitReason: 'cadence_archived',
    },
  })

  // Set cadence status to ARCHIVED
  const archived = await db.cadence.update({
    where: { id },
    data: { status: 'ARCHIVED' },
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
  })

  return archived
}

/**
 * Adds a step to a cadence.
 *
 * - Rejects if cadence is ARCHIVED
 * - Auto-calculates stepOrder as max(existing) + 1
 * - Validates step data with Zod
 *
 * Validates: Requirements 6.4, 6.10
 *
 * @param cadenceId - The cadence to add the step to
 * @param data - The step creation data (actionType, delayHours, etc.)
 * @param orgId - The organization ID
 * @returns The created step
 */
export async function addStep(
  cadenceId: string,
  data: unknown,
  orgId: string,
) {
  if (!cadenceId) {
    throw new AppError('VALIDATION_ERROR', 'Cadence ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  // Verify cadence exists and is not archived
  const cadence = await db.cadence.findFirst({
    where: { id: cadenceId },
    include: { steps: { orderBy: { stepOrder: 'desc' }, take: 1 } },
  })

  if (!cadence) {
    throw new AppError('NOT_FOUND', 'Cadence not found', 404)
  }

  if (cadence.status === 'ARCHIVED') {
    throw new AppError(
      'INVALID_STATE',
      'Cannot modify steps on an archived cadence',
      400,
    )
  }

  // Validate step data (stepOrder from input is ignored — we auto-calculate)
  const validated = stepCreateSchema.parse(data)

  // Auto-calculate stepOrder as max(existing) + 1
  const maxOrder = cadence.steps.length > 0 ? cadence.steps[0].stepOrder : 0
  const nextOrder = maxOrder + 1

  // For non-EMAIL steps, accept either `taskTitle` (preferred) or
  // `instructions` (legacy alias used by the inline add form).
  const taskTitle = validated.taskTitle ?? validated.instructions ?? null

  const step = await db.cadenceStep.create({
    data: tenantData({
      cadenceId,
      stepOrder: nextOrder,
      actionType: validated.actionType,
      delayHours: validated.delayHours,
      emailSubject: validated.subject ?? null,
      emailBody: validated.body ?? null,
      taskTitle,
      taskDescription: validated.taskDescription ?? null,
    }),
  })

  return step
}

/**
 * Updates an existing step on a cadence.
 *
 * - Rejects if cadence is ARCHIVED (no edits allowed on archived cadences).
 * - Verifies the step belongs to the cadence in the caller's tenant.
 * - Validates patch fields with Zod; only provided fields are written.
 * - Step ordering is **not** updatable here — use `reorderSteps`
 *   (Requirement 6.4 keeps step orders contiguous starting from 1).
 *
 * Validates: Requirements 6.4, 6.10
 *
 * @param cadenceId - The cadence the step belongs to
 * @param stepId    - The step to update
 * @param data      - Partial step fields to patch
 * @param orgId     - The organization ID (tenant scope)
 * @returns The updated step
 */
export async function updateStep(
  cadenceId: string,
  stepId: string,
  data: unknown,
  orgId: string,
) {
  if (!cadenceId) {
    throw new AppError('VALIDATION_ERROR', 'Cadence ID is required', 400)
  }
  if (!stepId) {
    throw new AppError('VALIDATION_ERROR', 'Step ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  // Verify cadence exists and is not archived. We pull the cadence first
  // (rather than the step) so the ARCHIVED guard runs before the step
  // existence check, matching the contract used by `addStep`.
  const cadence = await db.cadence.findFirst({
    where: { id: cadenceId },
  })

  if (!cadence) {
    throw new AppError('NOT_FOUND', 'Cadence not found', 404)
  }

  if (cadence.status === 'ARCHIVED') {
    throw new AppError(
      'INVALID_STATE',
      'Cannot modify steps on an archived cadence',
      400,
    )
  }

  // Verify step exists and belongs to this cadence in this tenant.
  const step = await db.cadenceStep.findFirst({
    where: { id: stepId, cadenceId },
  })

  if (!step) {
    throw new AppError('NOT_FOUND', 'Step not found', 404)
  }

  const validated = stepUpdateSchema.parse(data)

  // Build the prisma update payload from only the fields that were
  // explicitly provided. We avoid spreading `validated` directly because
  // the shape doesn't match the prisma column names (subject → emailSubject,
  // body → emailBody).
  const update: Record<string, unknown> = {}
  if (validated.actionType !== undefined) update.actionType = validated.actionType
  if (validated.delayHours !== undefined) update.delayHours = validated.delayHours
  if (validated.subject !== undefined) update.emailSubject = validated.subject ?? null
  if (validated.body !== undefined) update.emailBody = validated.body ?? null
  if (validated.taskTitle !== undefined) update.taskTitle = validated.taskTitle ?? null
  if (validated.taskDescription !== undefined) {
    update.taskDescription = validated.taskDescription ?? null
  }

  const updated = await db.cadenceStep.update({
    where: { id: stepId },
    data: update,
  })

  return updated
}

/**
 * Deletes a step from a cadence and renumbers the remaining steps so
 * orders stay contiguous starting from 1 (Requirement 6.4).
 *
 * Guardrails:
 * - Rejects if the cadence is ARCHIVED.
 * - Rejects if the cadence has any ACTIVE or PAUSED enrollments — those
 *   enrollments may have already advanced past the deleted step's order
 *   and dropping a step out from underneath them would leave the schedule
 *   inconsistent. Callers should pause/exit enrollments first or wait for
 *   them to complete (matches the original frontend's "no edits while
 *   active enrollments exist" rule).
 *
 * The delete + renumber happens inside a transaction so a failure
 * partway through cannot leave the cadence with a hole or duplicate
 * step orders.
 *
 * Validates: Requirements 6.4, 6.10
 *
 * @param cadenceId - The cadence the step belongs to
 * @param stepId    - The step to delete
 * @param orgId     - The organization ID (tenant scope)
 * @returns Object with the deleted step id and the renumbered remaining steps
 */
export async function deleteStep(
  cadenceId: string,
  stepId: string,
  orgId: string,
) {
  if (!cadenceId) {
    throw new AppError('VALIDATION_ERROR', 'Cadence ID is required', 400)
  }
  if (!stepId) {
    throw new AppError('VALIDATION_ERROR', 'Step ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  const cadence = await db.cadence.findFirst({
    where: { id: cadenceId },
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
  })

  if (!cadence) {
    throw new AppError('NOT_FOUND', 'Cadence not found', 404)
  }

  if (cadence.status === 'ARCHIVED') {
    throw new AppError(
      'INVALID_STATE',
      'Cannot modify steps on an archived cadence',
      400,
    )
  }

  const step = cadence.steps.find((s) => s.id === stepId)
  if (!step) {
    throw new AppError('NOT_FOUND', 'Step not found', 404)
  }

  // Block deletes while enrollments are running — those enrollments
  // may have advanced past this step already. The UI should pause or
  // exit them first.
  const liveEnrollments = await db.cadenceEnrollment.count({
    where: {
      cadenceId,
      status: { in: ['ACTIVE', 'PAUSED'] },
    },
  })

  if (liveEnrollments > 0) {
    throw new AppError(
      'ACTIVE_ENROLLMENTS',
      `Cannot delete a step while ${liveEnrollments} enrollment(s) are active or paused. Exit them first or wait for them to complete.`,
      409,
    )
  }

  // Determine the post-delete step order so we can renumber in a single
  // pass. Steps after the deleted one shift down by 1.
  const remaining = cadence.steps.filter((s) => s.id !== stepId)

  const remainingIds = await prisma.$transaction(async (tx) => {
    await tx.cadenceStep.delete({ where: { id: stepId } })

    // Two-pass renumber to avoid violating the [cadenceId, stepOrder]
    // unique constraint, mirroring the approach used by `reorderSteps`.
    for (let i = 0; i < remaining.length; i++) {
      await tx.cadenceStep.update({
        where: { id: remaining[i].id },
        data: { stepOrder: -(i + 1) },
      })
    }
    for (let i = 0; i < remaining.length; i++) {
      await tx.cadenceStep.update({
        where: { id: remaining[i].id },
        data: { stepOrder: i + 1 },
      })
    }

    return remaining.map((s) => s.id)
  })

  // Re-read so callers get the freshly renumbered rows in order.
  const renumberedSteps = remainingIds.length
    ? await db.cadenceStep.findMany({
        where: { cadenceId },
        orderBy: { stepOrder: 'asc' },
      })
    : []

  return { deletedStepId: stepId, steps: renumberedSteps }
}

/**
 * Reorders steps within a cadence. The provided stepIds array defines
 * the new order — steps are assigned contiguous integer orders starting from 1.
 *
 * - Rejects if cadence is ARCHIVED
 * - Validates all provided stepIds belong to the cadence
 * - Validates no steps are lost or duplicated
 * - Uses two-pass update to avoid unique constraint violations on [cadenceId, stepOrder]
 *
 * Validates: Requirement 6.4 (step orders are contiguous integers starting from 1)
 *
 * @param cadenceId - The cadence whose steps to reorder
 * @param stepIds - Array of step IDs in the desired new order
 * @param orgId - The organization ID
 * @returns The updated steps in their new order
 */
export async function reorderSteps(
  cadenceId: string,
  stepIds: string[],
  orgId: string,
) {
  if (!cadenceId) {
    throw new AppError('VALIDATION_ERROR', 'Cadence ID is required', 400)
  }
  if (!stepIds || stepIds.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Step IDs are required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  // Verify cadence exists and is not archived
  const cadence = await db.cadence.findFirst({
    where: { id: cadenceId },
    include: { steps: true },
  })

  if (!cadence) {
    throw new AppError('NOT_FOUND', 'Cadence not found', 404)
  }

  if (cadence.status === 'ARCHIVED') {
    throw new AppError(
      'INVALID_STATE',
      'Cannot modify steps on an archived cadence',
      400,
    )
  }

  // Validate all stepIds belong to this cadence
  const existingStepIds = new Set(cadence.steps.map((s) => s.id))
  const providedStepIds = new Set(stepIds)

  // Check for duplicates in the provided array
  if (providedStepIds.size !== stepIds.length) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Duplicate step IDs are not allowed',
      400,
    )
  }

  // Check that all provided IDs belong to the cadence
  for (const stepId of stepIds) {
    if (!existingStepIds.has(stepId)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Step ${stepId} does not belong to this cadence`,
        400,
      )
    }
  }

  // Check that no steps are missing
  if (stepIds.length !== cadence.steps.length) {
    throw new AppError(
      'VALIDATION_ERROR',
      'All steps must be included in the reorder — no steps can be lost or added',
      400,
    )
  }

  // Update step orders as contiguous integers starting from 1.
  // Use a transaction with two passes to avoid unique constraint violations
  // on [cadenceId, stepOrder] during the reorder.
  const updatedSteps = await prisma.$transaction(async (tx) => {
    // First pass: set all orders to negative values to clear the unique constraint
    for (let i = 0; i < stepIds.length; i++) {
      await tx.cadenceStep.update({
        where: { id: stepIds[i] },
        data: { stepOrder: -(i + 1) },
      })
    }

    // Second pass: set the final contiguous orders
    for (let i = 0; i < stepIds.length; i++) {
      await tx.cadenceStep.update({
        where: { id: stepIds[i] },
        data: { stepOrder: i + 1 },
      })
    }

    // Return the updated steps in order
    return tx.cadenceStep.findMany({
      where: { cadenceId },
      orderBy: { stepOrder: 'asc' },
    })
  })

  return updatedSteps
}


// ─── Enrollment Service ──────────────────────────────────────────────────────

/**
 * Enrolls a lead in a cadence.
 *
 * - Verifies the cadence exists and is ACTIVE
 * - Checks no duplicate ACTIVE enrollment for the same lead+cadence pair
 * - Creates enrollment with status ACTIVE and currentStepOrder 1
 *
 * Validates: Requirements 6.5, 6.6
 *
 * @param cadenceId - The cadence to enroll the lead in
 * @param leadId - The lead to enroll
 * @param userId - The user performing the enrollment
 * @param orgId - The organization ID
 * @returns The created enrollment
 */
export async function enrollLead(
  cadenceId: string,
  leadId: string,
  userId: string,
  orgId: string,
) {
  if (!cadenceId) {
    throw new AppError('VALIDATION_ERROR', 'Cadence ID is required', 400)
  }
  if (!leadId) {
    throw new AppError('VALIDATION_ERROR', 'Lead ID is required', 400)
  }
  if (!userId) {
    throw new AppError('VALIDATION_ERROR', 'User ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  // Verify cadence exists and is ACTIVE
  const cadence = await db.cadence.findFirst({
    where: { id: cadenceId },
  })

  if (!cadence) {
    throw new AppError('NOT_FOUND', 'Cadence not found', 404)
  }

  if (cadence.status !== 'ACTIVE') {
    throw new AppError(
      'INVALID_STATE',
      'Can only enroll leads in an ACTIVE cadence',
      400,
    )
  }

  // Check for existing ACTIVE enrollment for this lead+cadence
  const existingEnrollment = await db.cadenceEnrollment.findFirst({
    where: {
      cadenceId,
      leadId,
      status: 'ACTIVE',
    },
  })

  if (existingEnrollment) {
    throw new AppError(
      'DUPLICATE_ENROLLMENT',
      'Lead already has an active enrollment in this cadence',
      409,
    )
  }

  // Create enrollment with status ACTIVE and currentStepOrder 1
  const enrollment = await db.cadenceEnrollment.create({
    data: tenantData({
      cadenceId,
      leadId,
      enrolledById: userId,
      status: 'ACTIVE',
      currentStepOrder: 1,
    }),
  })

  return enrollment
}

/**
 * Bulk enrolls multiple leads in a cadence.
 *
 * - Same validations as enrollLead per lead
 * - Skips leads that already have an ACTIVE enrollment (doesn't throw)
 * - Returns results with enrolled and skipped counts
 *
 * Validates: Requirements 6.5, 6.6
 *
 * @param cadenceId - The cadence to enroll leads in
 * @param leadIds - Array of lead IDs to enroll
 * @param userId - The user performing the enrollment
 * @param orgId - The organization ID
 * @returns Object with enrolled enrollments and skipped lead IDs
 */
export async function bulkEnroll(
  cadenceId: string,
  leadIds: string[],
  userId: string,
  orgId: string,
) {
  if (!cadenceId) {
    throw new AppError('VALIDATION_ERROR', 'Cadence ID is required', 400)
  }
  if (!leadIds || leadIds.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'At least one lead ID is required', 400)
  }
  if (!userId) {
    throw new AppError('VALIDATION_ERROR', 'User ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  // Verify cadence exists and is ACTIVE
  const cadence = await db.cadence.findFirst({
    where: { id: cadenceId },
  })

  if (!cadence) {
    throw new AppError('NOT_FOUND', 'Cadence not found', 404)
  }

  if (cadence.status !== 'ACTIVE') {
    throw new AppError(
      'INVALID_STATE',
      'Can only enroll leads in an ACTIVE cadence',
      400,
    )
  }

  // Find existing ACTIVE enrollments for these leads in this cadence
  const existingEnrollments = await db.cadenceEnrollment.findMany({
    where: {
      cadenceId,
      leadId: { in: leadIds },
      status: 'ACTIVE',
    },
    select: { leadId: true },
  })

  const alreadyEnrolledLeadIds = new Set(existingEnrollments.map((e) => e.leadId))

  // Filter out leads that already have active enrollments
  const leadsToEnroll = leadIds.filter((id) => !alreadyEnrolledLeadIds.has(id))
  const skippedLeadIds = leadIds.filter((id) => alreadyEnrolledLeadIds.has(id))

  // Create enrollments for eligible leads
  const enrolled: Array<Record<string, unknown>> = []

  for (const leadId of leadsToEnroll) {
    const enrollment = await db.cadenceEnrollment.create({
      data: tenantData({
        cadenceId,
        leadId,
        enrolledById: userId,
        status: 'ACTIVE',
        currentStepOrder: 1,
      }),
    })
    enrolled.push(enrollment)
  }

  return {
    enrolled,
    skipped: skippedLeadIds,
    enrolledCount: enrolled.length,
    skippedCount: skippedLeadIds.length,
  }
}

/**
 * Pauses an active enrollment.
 *
 * - Validates the enrollment exists and is ACTIVE
 * - Sets status to PAUSED
 * - Note: Cancelling pending Inngest jobs is handled in task 8.4
 *
 * Validates: Requirement 32.2
 *
 * @param enrollmentId - The enrollment to pause
 * @param userId - The user performing the action
 * @param orgId - The organization ID
 * @returns The paused enrollment
 */
export async function pauseEnrollment(
  enrollmentId: string,
  userId: string,
  orgId: string,
) {
  if (!enrollmentId) {
    throw new AppError('VALIDATION_ERROR', 'Enrollment ID is required', 400)
  }
  if (!userId) {
    throw new AppError('VALIDATION_ERROR', 'User ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  const enrollment = await db.cadenceEnrollment.findFirst({
    where: { id: enrollmentId },
  })

  if (!enrollment) {
    throw new AppError('NOT_FOUND', 'Enrollment not found', 404)
  }

  if (enrollment.status !== 'ACTIVE') {
    throw new AppError(
      'INVALID_STATE',
      'Only ACTIVE enrollments can be paused',
      400,
    )
  }

  // Set status to PAUSED
  // Note: Cancelling pending Inngest jobs will be handled in task 8.4
  const paused = await db.cadenceEnrollment.update({
    where: { id: enrollmentId },
    data: { status: 'PAUSED' },
  })

  return paused
}

/**
 * Resumes a paused enrollment.
 *
 * - Validates the enrollment exists and is PAUSED
 * - Sets status back to ACTIVE
 * - Note: Scheduling next step via Inngest is handled in task 8.4
 *
 * Validates: Requirement 32.3
 *
 * @param enrollmentId - The enrollment to resume
 * @param userId - The user performing the action
 * @param orgId - The organization ID
 * @returns The resumed enrollment
 */
export async function resumeEnrollment(
  enrollmentId: string,
  userId: string,
  orgId: string,
) {
  if (!enrollmentId) {
    throw new AppError('VALIDATION_ERROR', 'Enrollment ID is required', 400)
  }
  if (!userId) {
    throw new AppError('VALIDATION_ERROR', 'User ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  const enrollment = await db.cadenceEnrollment.findFirst({
    where: { id: enrollmentId },
  })

  if (!enrollment) {
    throw new AppError('NOT_FOUND', 'Enrollment not found', 404)
  }

  if (enrollment.status !== 'PAUSED') {
    throw new AppError(
      'INVALID_STATE',
      'Only PAUSED enrollments can be resumed',
      400,
    )
  }

  // Set status back to ACTIVE
  // Note: Scheduling next step via Inngest will be handled in task 8.4
  const resumed = await db.cadenceEnrollment.update({
    where: { id: enrollmentId },
    data: { status: 'ACTIVE' },
  })

  return resumed
}

/**
 * Exits an enrollment with a specified reason.
 *
 * - Sets status to EXITED with the provided exit reason
 * - Valid reasons: reply_received, meeting_booked, cadence_archived, lead_converted, manual
 *
 * Validates: Requirements 6.8, 6.9
 *
 * @param enrollmentId - The enrollment to exit
 * @param reason - The exit reason
 * @param orgId - The organization ID
 * @returns The exited enrollment
 */
export async function exitEnrollment(
  enrollmentId: string,
  reason: ExitReason,
  orgId: string,
) {
  if (!enrollmentId) {
    throw new AppError('VALIDATION_ERROR', 'Enrollment ID is required', 400)
  }
  if (!reason) {
    throw new AppError('VALIDATION_ERROR', 'Exit reason is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const validReasons: ExitReason[] = [
    'reply_received',
    'meeting_booked',
    'cadence_archived',
    'lead_converted',
    'manual',
  ]

  if (!validReasons.includes(reason)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Invalid exit reason. Must be one of: ${validReasons.join(', ')}`,
      400,
    )
  }

  const db = createTenantPrisma(orgId)

  const enrollment = await db.cadenceEnrollment.findFirst({
    where: { id: enrollmentId },
  })

  if (!enrollment) {
    throw new AppError('NOT_FOUND', 'Enrollment not found', 404)
  }

  // Only ACTIVE or PAUSED enrollments can be exited
  if (enrollment.status === 'COMPLETED' || enrollment.status === 'EXITED') {
    throw new AppError(
      'INVALID_STATE',
      `Cannot exit an enrollment that is already ${enrollment.status}`,
      400,
    )
  }

  const exited = await db.cadenceEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'EXITED',
      exitReason: reason,
    },
  })

  return exited
}

/**
 * Completes an enrollment after the final step has been executed.
 *
 * - Sets status to COMPLETED and records completedAt timestamp
 *
 * Validates: Requirement 6.8
 *
 * @param enrollmentId - The enrollment to complete
 * @param orgId - The organization ID
 * @returns The completed enrollment
 */
export async function completeEnrollment(
  enrollmentId: string,
  orgId: string,
) {
  if (!enrollmentId) {
    throw new AppError('VALIDATION_ERROR', 'Enrollment ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  const enrollment = await db.cadenceEnrollment.findFirst({
    where: { id: enrollmentId },
  })

  if (!enrollment) {
    throw new AppError('NOT_FOUND', 'Enrollment not found', 404)
  }

  if (enrollment.status !== 'ACTIVE') {
    throw new AppError(
      'INVALID_STATE',
      'Only ACTIVE enrollments can be completed',
      400,
    )
  }

  const completed = await db.cadenceEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
    },
  })

  return completed
}

/**
 * Handles conditional exit for a lead when a reply is received.
 *
 * - Finds all ACTIVE enrollments for the lead and exits them with reason "reply_received"
 *
 * Validates: Requirement 6.9
 *
 * @param leadId - The lead that received a reply
 * @param orgId - The organization ID
 * @returns Number of enrollments exited
 */
export async function handleReplyReceived(
  leadId: string,
  orgId: string,
) {
  if (!leadId) {
    throw new AppError('VALIDATION_ERROR', 'Lead ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  const result = await db.cadenceEnrollment.updateMany({
    where: {
      leadId,
      status: 'ACTIVE',
    },
    data: {
      status: 'EXITED',
      exitReason: 'reply_received',
    },
  })

  return result.count
}

/**
 * Handles conditional exit for a lead when a meeting is booked.
 *
 * - Finds all ACTIVE enrollments for the lead and exits them with reason "meeting_booked"
 *
 * Validates: Requirement 6.9
 *
 * @param leadId - The lead that booked a meeting
 * @param orgId - The organization ID
 * @returns Number of enrollments exited
 */
export async function handleMeetingBooked(
  leadId: string,
  orgId: string,
) {
  if (!leadId) {
    throw new AppError('VALIDATION_ERROR', 'Lead ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  const result = await db.cadenceEnrollment.updateMany({
    where: {
      leadId,
      status: 'ACTIVE',
    },
    data: {
      status: 'EXITED',
      exitReason: 'meeting_booked',
    },
  })

  return result.count
}
