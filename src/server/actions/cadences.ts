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
  reorderSteps as reorderStepsService,
} from '@/server/services/cadences'
import { createTenantPrisma } from '@/server/db/middleware'
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
      data: {
        userId: session.dbUser.id,
        action: 'CREATE',
        entityType: 'Cadence',
        entityId: cadence.id,
      } as any,
    }).catch((err) => {
      console.error('Audit log failed (createCadence):', err)
    })

    revalidatePath('/cadences')
    return { data: cadence }
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return { error: err.errors[0]?.message ?? 'Validation failed' }
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
      data: {
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'Cadence',
        entityId: id,
        metadata: JSON.stringify({ action: 'activate' }),
      } as any,
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
      data: {
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'Cadence',
        entityId: id,
        metadata: JSON.stringify({ action: 'archive' }),
      } as any,
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
 * Optional fields: subject, body, instructions
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
  }

  try {
    const step = await addStepService(cadenceId, data, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: {
        userId: session.dbUser.id,
        action: 'CREATE',
        entityType: 'CadenceStep',
        entityId: step.id,
        metadata: JSON.stringify({ cadenceId }),
      } as any,
    }).catch((err) => {
      console.error('Audit log failed (addStep):', err)
    })

    revalidatePath('/cadences')
    return { data: step }
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return { error: err.errors[0]?.message ?? 'Validation failed' }
    }
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to add step. Please try again.' }
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
      data: {
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'Cadence',
        entityId: cadenceId,
        metadata: JSON.stringify({ action: 'reorder_steps' }),
      } as any,
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
      data: {
        userId: session.dbUser.id,
        action: 'CREATE',
        entityType: 'CadenceEnrollment',
        entityId: enrollment.id,
        metadata: JSON.stringify({ cadenceId, leadId }),
      } as any,
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
      data: {
        userId: session.dbUser.id,
        action: 'CREATE',
        entityType: 'CadenceEnrollment',
        entityId: cadenceId,
        metadata: JSON.stringify({
          action: 'bulk_enroll',
          enrolledCount: result.enrolledCount,
          skippedCount: result.skippedCount,
        }),
      } as any,
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
      data: {
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'CadenceEnrollment',
        entityId: enrollmentId,
        metadata: JSON.stringify({ action: 'pause' }),
      } as any,
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
      data: {
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'CadenceEnrollment',
        entityId: enrollmentId,
        metadata: JSON.stringify({ action: 'resume' }),
      } as any,
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
      data: {
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'CadenceEnrollment',
        entityId: enrollmentId,
        metadata: JSON.stringify({ action: 'exit', reason }),
      } as any,
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
