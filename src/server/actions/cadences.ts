'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import {
  createCadence as createCadenceService,
  activateCadence as activateCadenceService,
  archiveCadence as archiveCadenceService,
  enrollLead as enrollLeadService,
  bulkEnroll as bulkEnrollService,
  pauseEnrollment as pauseEnrollmentService,
  resumeEnrollment as resumeEnrollmentService,
  exitEnrollment as exitEnrollmentService,
  addStep as addStepService,
  updateStep as updateStepService,
  deleteStep as deleteStepService,
  reorderSteps as reorderStepsService,
} from '@/server/services/cadences'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { fieldErrorsFromZod } from '@/server/actions/field-errors'
import { ZodError } from 'zod'

/**
 * Server Actions for cadence management mutations.
 *
 * Each action:
 * 1. Authenticates via requireSession()
 * 2. Authorizes via requirePermission('cadences:manage')
 * 3. Parses input (formData or arguments)
 * 4. Calls the service function
 * 5. Logs an audit entry (async, non-blocking)
 * 6. Calls revalidatePath('/cadences') to refresh cached data
 * 7. Returns { data } on success or { error } on failure
 *
 * Validates: Requirements 6.1, 6.2, 6.5, 32.1, 32.2, 32.3, 32.4, 32.5
 */

/**
 * Creates a new cadence from form data.
 *
 * Required fields: name
 * Optional fields: description
 */
export async function createCadence(formData: FormData) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'cadences:manage')

  const data = {
    name: formData.get('name') as string,
    description: formData.get('description') as string | null,
  }

  try {
    const cadence = await createCadenceService(data, session.dbUser.id, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'CREATE',
        entityType: 'Cadence',
        entityId: cadence.id,
      }),
    }).catch((err) => {
      console.error('Audit log failed (createCadence):', err)
    })

    revalidatePath('/cadences')
    return { data: cadence }
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return {
        error: err.errors[0]?.message ?? 'Validation failed',
        fieldErrors: fieldErrorsFromZod(err),
      }
    }
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to create cadence. Please try again.' }
  }
}

/**
 * Activates a cadence by ID.
 *
 * Transitions from DRAFT to ACTIVE. Requires at least one step.
 */
export async function activateCadence(id: string) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'cadences:manage')

  if (!id) {
    return { error: 'Cadence ID is required' }
  }

  try {
    const cadence = await activateCadenceService(id, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'Cadence',
        entityId: id,
        changes: { action: 'activate' },
      }),
    }).catch((err) => {
      console.error('Audit log failed (activateCadence):', err)
    })

    revalidatePath('/cadences')
    return { data: cadence }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to activate cadence. Please try again.' }
  }
}

/**
 * Archives a cadence by ID.
 *
 * Exits all active enrollments with reason "cadence_archived".
 */
export async function archiveCadence(id: string) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'cadences:manage')

  if (!id) {
    return { error: 'Cadence ID is required' }
  }

  try {
    const cadence = await archiveCadenceService(id, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'Cadence',
        entityId: id,
        changes: { action: 'archive' },
      }),
    }).catch((err) => {
      console.error('Audit log failed (archiveCadence):', err)
    })

    revalidatePath('/cadences')
    return { data: cadence }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to archive cadence. Please try again.' }
  }
}

/**
 * Adds a step to a cadence from form data.
 *
 * Required fields: cadenceId, actionType, delayHours
 * Optional fields:
 *   - EMAIL steps: subject, body
 *   - non-EMAIL steps: taskTitle, taskDescription
 *   - instructions (legacy alias mapped to taskTitle by the service)
 */
export async function addStep(formData: FormData) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'cadences:manage')

  const cadenceId = formData.get('cadenceId') as string | null
  if (!cadenceId) {
    return { error: 'Cadence ID is required' }
  }

  const data = {
    actionType: formData.get('actionType') as string,
    stepOrder: 1, // Auto-calculated by service
    delayHours: Number(formData.get('delayHours') ?? 0),
    subject: formData.get('subject') as string | null,
    body: formData.get('body') as string | null,
    instructions: formData.get('instructions') as string | null,
    taskTitle: formData.get('taskTitle') as string | null,
    taskDescription: formData.get('taskDescription') as string | null,
    // Defaults to false; the validator coerces 'true'/'on'/boolean.
    startNewThread: formData.get('startNewThread') as string | null,
  }

  try {
    const step = await addStepService(cadenceId, data, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'CREATE',
        entityType: 'CadenceStep',
        entityId: step.id,
        changes: { cadenceId },
      }),
    }).catch((err) => {
      console.error('Audit log failed (addStep):', err)
    })

    revalidatePath('/cadences')
    return { data: step }
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return {
        error: err.errors[0]?.message ?? 'Validation failed',
        fieldErrors: fieldErrorsFromZod(err),
      }
    }
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to add step. Please try again.' }
  }
}

/**
 * Updates an existing step on a cadence.
 *
 * Accepts a partial patch — only fields present in `data` are written.
 * The service rejects updates on archived cadences and on steps that
 * don't belong to the caller's tenant.
 *
 * @param cadenceId - The cadence the step belongs to
 * @param stepId    - The step to update
 * @param data      - Partial step fields (actionType/delayHours/subject/body/taskTitle/taskDescription)
 */
export async function updateStep(
  cadenceId: string,
  stepId: string,
  data: {
    actionType?: string
    delayHours?: number
    subject?: string | null
    body?: string | null
    taskTitle?: string | null
    taskDescription?: string | null
    startNewThread?: boolean
  },
) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'cadences:manage')

  if (!cadenceId) {
    return { error: 'Cadence ID is required' }
  }
  if (!stepId) {
    return { error: 'Step ID is required' }
  }

  try {
    const step = await updateStepService(
      cadenceId,
      stepId,
      data,
      session.organizationId,
    )

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'CadenceStep',
        entityId: stepId,
        changes: { cadenceId },
      }),
    }).catch((err) => {
      console.error('Audit log failed (updateStep):', err)
    })

    revalidatePath('/cadences')
    revalidatePath(`/cadences/${cadenceId}`)
    return { data: step }
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return {
        error: err.errors[0]?.message ?? 'Validation failed',
        fieldErrors: fieldErrorsFromZod(err),
      }
    }
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to update step. Please try again.' }
  }
}

/**
 * Deletes a step from a cadence and renumbers the remaining steps.
 *
 * Rejects when the cadence is archived or has any ACTIVE/PAUSED
 * enrollments — see the service docs for the rationale.
 *
 * @param cadenceId - The cadence the step belongs to
 * @param stepId    - The step to delete
 */
export async function deleteStep(cadenceId: string, stepId: string) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'cadences:manage')

  if (!cadenceId) {
    return { error: 'Cadence ID is required' }
  }
  if (!stepId) {
    return { error: 'Step ID is required' }
  }

  try {
    const result = await deleteStepService(
      cadenceId,
      stepId,
      session.organizationId,
    )

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'DELETE',
        entityType: 'CadenceStep',
        entityId: stepId,
        changes: { cadenceId },
      }),
    }).catch((err) => {
      console.error('Audit log failed (deleteStep):', err)
    })

    revalidatePath('/cadences')
    revalidatePath(`/cadences/${cadenceId}`)
    return { data: result }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to delete step. Please try again.' }
  }
}

/**
 * Reorders steps within a cadence.
 *
 * @param cadenceId - The cadence whose steps to reorder
 * @param stepIds - Array of step IDs in the desired new order
 */
export async function reorderSteps(cadenceId: string, stepIds: string[]) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'cadences:manage')

  if (!cadenceId) {
    return { error: 'Cadence ID is required' }
  }
  if (!stepIds || stepIds.length === 0) {
    return { error: 'Step IDs are required' }
  }

  try {
    const steps = await reorderStepsService(cadenceId, stepIds, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'Cadence',
        entityId: cadenceId,
        changes: { action: 'reorder_steps' },
      }),
    }).catch((err) => {
      console.error('Audit log failed (reorderSteps):', err)
    })

    revalidatePath('/cadences')
    return { data: steps }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to reorder steps. Please try again.' }
  }
}

/**
 * Enrolls a lead in a cadence.
 *
 * @param cadenceId - The cadence to enroll the lead in
 * @param leadId - The lead to enroll
 */
export async function enrollLead(cadenceId: string, leadId: string) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'cadences:manage')

  if (!cadenceId) {
    return { error: 'Cadence ID is required' }
  }
  if (!leadId) {
    return { error: 'Lead ID is required' }
  }

  try {
    const enrollment = await enrollLeadService(
      cadenceId,
      leadId,
      session.dbUser.id,
      session.organizationId,
    )

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'CREATE',
        entityType: 'CadenceEnrollment',
        entityId: enrollment.id,
        changes: { cadenceId, leadId },
      }),
    }).catch((err) => {
      console.error('Audit log failed (enrollLead):', err)
    })

    revalidatePath('/cadences')
    return { data: enrollment }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to enroll lead. Please try again.' }
  }
}

/**
 * Bulk enrolls multiple leads in a cadence.
 *
 * @param cadenceId - The cadence to enroll leads in
 * @param leadIds - Array of lead IDs to enroll
 */
export async function bulkEnrollLeads(cadenceId: string, leadIds: string[]) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'cadences:manage')

  if (!cadenceId) {
    return { error: 'Cadence ID is required' }
  }
  if (!leadIds || leadIds.length === 0) {
    return { error: 'At least one lead ID is required' }
  }

  try {
    const result = await bulkEnrollService(
      cadenceId,
      leadIds,
      session.dbUser.id,
      session.organizationId,
    )

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'CREATE',
        entityType: 'CadenceEnrollment',
        entityId: cadenceId,
        changes: {
          action: 'bulk_enroll',
          enrolledCount: result.enrolledCount,
          skippedCount: result.skippedCount,
        },
      }),
    }).catch((err) => {
      console.error('Audit log failed (bulkEnrollLeads):', err)
    })

    revalidatePath('/cadences')
    return { data: result }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to bulk enroll leads. Please try again.' }
  }
}

/**
 * Pauses an active enrollment.
 *
 * @param enrollmentId - The enrollment to pause
 */
export async function pauseEnrollment(enrollmentId: string) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'cadences:manage')

  if (!enrollmentId) {
    return { error: 'Enrollment ID is required' }
  }

  try {
    const enrollment = await pauseEnrollmentService(
      enrollmentId,
      session.dbUser.id,
      session.organizationId,
    )

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'CadenceEnrollment',
        entityId: enrollmentId,
        changes: { action: 'pause' },
      }),
    }).catch((err) => {
      console.error('Audit log failed (pauseEnrollment):', err)
    })

    revalidatePath('/cadences')
    return { data: enrollment }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to pause enrollment. Please try again.' }
  }
}

/**
 * Resumes a paused enrollment.
 *
 * @param enrollmentId - The enrollment to resume
 */
export async function resumeEnrollment(enrollmentId: string) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'cadences:manage')

  if (!enrollmentId) {
    return { error: 'Enrollment ID is required' }
  }

  try {
    const enrollment = await resumeEnrollmentService(
      enrollmentId,
      session.dbUser.id,
      session.organizationId,
    )

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'CadenceEnrollment',
        entityId: enrollmentId,
        changes: { action: 'resume' },
      }),
    }).catch((err) => {
      console.error('Audit log failed (resumeEnrollment):', err)
    })

    revalidatePath('/cadences')
    return { data: enrollment }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to resume enrollment. Please try again.' }
  }
}

/**
 * Exits an enrollment with a specified reason.
 *
 * @param enrollmentId - The enrollment to exit
 * @param reason - The exit reason
 */
export async function exitEnrollment(
  enrollmentId: string,
  reason: 'reply_received' | 'meeting_booked' | 'cadence_archived' | 'lead_converted' | 'manual',
) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'cadences:manage')

  if (!enrollmentId) {
    return { error: 'Enrollment ID is required' }
  }
  if (!reason) {
    return { error: 'Exit reason is required' }
  }

  try {
    const enrollment = await exitEnrollmentService(
      enrollmentId,
      reason,
      session.organizationId,
    )

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'CadenceEnrollment',
        entityId: enrollmentId,
        changes: { action: 'exit', reason },
      }),
    }).catch((err) => {
      console.error('Audit log failed (exitEnrollment):', err)
    })

    revalidatePath('/cadences')
    return { data: enrollment }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to exit enrollment. Please try again.' }
  }
}
