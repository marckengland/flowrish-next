'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createLead as createLeadService, updateLead as updateLeadService, softDeleteLead, convertToContact as convertToContactService } from '@/server/services/leads'
import { createTenantPrisma } from '@/server/db/middleware'
import { ZodError } from 'zod'

/**
 * Server Actions for lead management mutations.
 *
 * Each action:
 * 1. Authenticates via requireSession()
 * 2. Authorizes via requirePermission()
 * 3. Parses formData into an object
 * 4. Calls the service function
 * 5. Logs an audit entry (async, non-blocking)
 * 6. Calls revalidatePath('/leads') to refresh cached data
 * 7. Returns { data } on success or { error } on failure
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 20.1
 */

/**
 * Creates a new lead from form data.
 *
 * Required fields: firstName, lastName, stageId
 * Optional fields: email, altEmail, phone, title, description, dealValue,
 *   currency, score, leadStatus, tier, linkedinUrl, country, state,
 *   companyName, companyIndustry, companyWebsite
 */
export async function createLead(formData: FormData) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'leads:write')

  // Parse formData into a plain object
  const data = formDataToObject(formData)

  try {
    const lead = await createLeadService(data, session.dbUser.id, session.organizationId)

    // Audit log: async, non-blocking
    // Note: organizationId is auto-injected by the tenant middleware at runtime
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: {
        userId: session.dbUser.id,
        action: 'CREATE',
        entityType: 'Lead',
        entityId: lead.id,
      } as any,
    }).catch((err) => {
      console.error('Audit log failed (createLead):', err)
    })

    revalidatePath('/leads')
    return { data: lead }
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return { error: err.errors[0]?.message ?? 'Validation failed' }
    }
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to create lead. Please try again.' }
  }
}

/**
 * Updates an existing lead from form data.
 *
 * Requires a lead `id` field in the form data.
 * All other fields are optional — only provided fields are updated.
 */
export async function updateLead(formData: FormData) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'leads:write')

  const id = formData.get('id') as string | null
  if (!id) {
    return { error: 'Lead ID is required' }
  }

  // Parse formData into a plain object, excluding the id field
  const data = formDataToObject(formData)
  delete data.id

  try {
    const lead = await updateLeadService(id, data, session.dbUser.id, session.organizationId)

    // Audit log: async, non-blocking
    // Note: organizationId is auto-injected by the tenant middleware at runtime
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: {
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'Lead',
        entityId: id,
      } as any,
    }).catch((err) => {
      console.error('Audit log failed (updateLead):', err)
    })

    revalidatePath('/leads')
    return { data: lead }
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return { error: err.errors[0]?.message ?? 'Validation failed' }
    }
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to update lead. Please try again.' }
  }
}

/**
 * Soft-deletes a lead by ID.
 *
 * Sets the `deletedAt` timestamp instead of removing the row.
 * Idempotent: deleting an already-deleted lead does not change deletedAt.
 */
export async function deleteLead(id: string) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'leads:delete')

  if (!id) {
    return { error: 'Lead ID is required' }
  }

  try {
    const lead = await softDeleteLead(id, session.dbUser.id, session.organizationId)

    // Audit log: async, non-blocking
    // Note: organizationId is auto-injected by the tenant middleware at runtime
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: {
        userId: session.dbUser.id,
        action: 'DELETE',
        entityType: 'Lead',
        entityId: id,
      } as any,
    }).catch((err) => {
      console.error('Audit log failed (deleteLead):', err)
    })

    revalidatePath('/leads')
    return { data: lead }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to delete lead. Please try again.' }
  }
}

/**
 * Converts a lead into a contact.
 *
 * - Creates a Contact record from the lead's personal data
 * - Moves the lead to the "Closed Won" stage (isClosed=true, closeDate=now)
 * - Links the contact to the lead via LeadContact
 * - Exits all active cadence enrollments with reason "lead_converted"
 *
 * Validates: Requirements 29.1, 29.2, 29.3, 29.4, 29.5
 */
export async function convertLead(id: string) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'leads:write')

  if (!id) {
    return { error: 'Lead ID is required' }
  }

  try {
    const result = await convertToContactService(
      id,
      session.dbUser.id,
      session.organizationId,
    )

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: {
        userId: session.dbUser.id,
        action: 'CONVERT',
        entityType: 'Lead',
        entityId: id,
      } as any,
    }).catch((err) => {
      console.error('Audit log failed (convertLead):', err)
    })

    revalidatePath(`/leads/${id}`)
    revalidatePath('/leads')
    revalidatePath('/contacts')
    return { data: result }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to convert lead. Please try again.' }
  }
}

/**
 * Converts FormData into a plain object suitable for Zod validation.
 *
 * - Skips empty string values (treats them as not provided)
 * - Converts numeric-looking values for dealValue and score
 */
function formDataToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {}

  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      // Skip empty strings for optional fields (let Zod defaults handle them)
      if (value === '') continue
      obj[key] = value
    }
  }

  // Coerce numeric fields if present
  if (obj.dealValue !== undefined) {
    obj.dealValue = Number(obj.dealValue)
  }
  if (obj.score !== undefined) {
    obj.score = Number(obj.score)
  }

  return obj
}
