'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import {
  createContact as createContactService,
  updateContact as updateContactService,
  deleteContact as deleteContactService,
  createCompany as createCompanyService,
  updateCompany as updateCompanyService,
  deleteCompany as deleteCompanyService,
} from '@/server/services/contacts'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { fieldErrorsFromZod } from '@/server/actions/field-errors'
import { ZodError } from 'zod'

/**
 * Server Actions for contact and company management mutations.
 *
 * Each action:
 * 1. Authenticates via requireSession()
 * 2. Authorizes via requirePermission()
 * 3. Parses formData into an object
 * 4. Calls the service function
 * 5. Logs an audit entry (async, non-blocking)
 * 6. Calls revalidatePath to refresh cached data
 * 7. Returns { data } on success or { error } on failure
 *
 * Validates: Requirements 19.1, 19.3, 20.1
 */

/**
 * Creates a new contact from form data.
 *
 * Required fields: firstName, lastName
 * Optional fields: email, phone, jobTitle, linkedinUrl, country, state, companyId
 */
export async function createContact(formData: FormData) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'contacts:write')

  const data = formDataToObject(formData)

  try {
    const contact = await createContactService(data, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'CREATE',
        entityType: 'Contact',
        entityId: contact.id,
      }),
    }).catch((err) => {
      console.error('Audit log failed (createContact):', err)
    })

    revalidatePath('/contacts')
    return { data: contact }
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
    return { error: 'Failed to create contact. Please try again.' }
  }
}

/**
 * Updates an existing contact from form data.
 *
 * Requires a contact `id` field in the form data.
 */
export async function updateContact(formData: FormData) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'contacts:write')

  const id = formData.get('id') as string | null
  if (!id) {
    return { error: 'Contact ID is required' }
  }

  const data = formDataToObject(formData)
  delete data.id

  try {
    const contact = await updateContactService(id, data, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'Contact',
        entityId: id,
      }),
    }).catch((err) => {
      console.error('Audit log failed (updateContact):', err)
    })

    revalidatePath('/contacts')
    return { data: contact }
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
    return { error: 'Failed to update contact. Please try again.' }
  }
}

/**
 * Deletes a contact by ID.
 */
export async function deleteContactAction(id: string) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'contacts:write')

  if (!id) {
    return { error: 'Contact ID is required' }
  }

  try {
    await deleteContactService(id, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'DELETE',
        entityType: 'Contact',
        entityId: id,
      }),
    }).catch((err) => {
      console.error('Audit log failed (deleteContact):', err)
    })

    revalidatePath('/contacts')
    return { data: { id } }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to delete contact. Please try again.' }
  }
}

/**
 * Creates a new company from form data.
 *
 * Required fields: name
 * Optional fields: industry, website
 */
export async function createCompany(formData: FormData) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'contacts:write')

  const data = formDataToObject(formData)

  try {
    const company = await createCompanyService(data, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'CREATE',
        entityType: 'Company',
        entityId: company.id,
      }),
    }).catch((err) => {
      console.error('Audit log failed (createCompany):', err)
    })

    revalidatePath('/companies')
    return { data: company }
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
    return { error: 'Failed to create company. Please try again.' }
  }
}

/**
 * Updates an existing company from form data.
 *
 * Requires a company `id` field in the form data.
 */
export async function updateCompany(formData: FormData) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'contacts:write')

  const id = formData.get('id') as string | null
  if (!id) {
    return { error: 'Company ID is required' }
  }

  const data = formDataToObject(formData)
  delete data.id

  try {
    const company = await updateCompanyService(id, data, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'Company',
        entityId: id,
      }),
    }).catch((err) => {
      console.error('Audit log failed (updateCompany):', err)
    })

    revalidatePath('/companies')
    return { data: company }
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
    return { error: 'Failed to update company. Please try again.' }
  }
}

/**
 * Deletes a company by ID.
 */
export async function deleteCompanyAction(id: string) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'contacts:write')

  if (!id) {
    return { error: 'Company ID is required' }
  }

  try {
    await deleteCompanyService(id, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: tenantData({
        userId: session.dbUser.id,
        action: 'DELETE',
        entityType: 'Company',
        entityId: id,
      }),
    }).catch((err) => {
      console.error('Audit log failed (deleteCompany):', err)
    })

    revalidatePath('/companies')
    return { data: { id } }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to delete company. Please try again.' }
  }
}

/**
 * Converts FormData into a plain object suitable for Zod validation.
 */
function formDataToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {}

  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      if (value === '') continue
      obj[key] = value
    }
  }

  return obj
}
