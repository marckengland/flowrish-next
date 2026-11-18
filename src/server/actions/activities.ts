'use server'

import { revalidatePath } from 'next/cache'
import { ZodError } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createActivity as createActivityService } from '@/server/services/activities'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'

/**
 * Server Actions for activity logging mutations.
 *
 * Each action:
 * 1. Authenticates via requireSession()
 * 2. Authorizes via requirePermission('leads:write')
 * 3. Parses input into an object
 * 4. Calls the service function
 * 5. Logs an audit entry (async, non-blocking)
 * 6. Revalidates the lead detail path so the timeline refetches
 * 7. Returns { data } on success or { error } on failure
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 20.1
 */

/**
 * Raw shape accepted from the client. The service layer re-validates
 * with the canonical Zod schema so the fields below are merely a typing
 * aid — narrowing happens server-side on submit.
 */
export interface CreateActivityInput {
  leadId: string
  type: 'CALL' | 'MEETING' | 'NOTE' | 'EMAIL' | 'FILE_ATTACHMENT'
  notes?: string | null
  callDate?: string | null
  callDuration?: number | null
  meetingDate?: string | null
  attendees?: string[] | null
}

/**
 * Creates a new activity for a lead.
 *
 * Accepts either an object payload (preferred for JSON submissions from
 * client components) or FormData (for progressive-enhancement forms).
 */
export async function createActivity(
  input: CreateActivityInput | FormData,
) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'leads:write')

  const data = input instanceof FormData ? formDataToActivity(input) : input

  try {
    const activity = await createActivityService(
      data,
      session.dbUser.id,
      session.organizationId,
    )

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry
      .create({
        data: tenantData({
          userId: session.dbUser.id,
          action: 'CREATE',
          entityType: 'Activity',
          entityId: activity.id,
        }),
      })
      .catch((err) => {
        console.error('Audit log failed (createActivity):', err)
      })

    // Refresh both the lead detail page and the list so the updated
    // lastActivityAt column on the listing reflects the new timestamp.
    if (data.leadId) {
      revalidatePath(`/leads/${data.leadId}`)
    }
    revalidatePath('/leads')

    return { data: activity }
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return { error: err.issues[0]?.message ?? 'Validation failed' }
    }
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to log activity. Please try again.' }
  }
}

/**
 * Converts a FormData submission into the activity payload shape. Empty
 * strings are coerced to `undefined` so Zod's optional fields remain unset
 * for types that don't use them (e.g. a NOTE must not carry meetingDate).
 */
function formDataToActivity(formData: FormData): CreateActivityInput {
  const type = (formData.get('type') as CreateActivityInput['type']) ?? 'NOTE'
  const leadId = String(formData.get('leadId') ?? '')
  const notes = valueOrUndefined(formData.get('notes'))
  const callDate = valueOrUndefined(formData.get('callDate'))
  const meetingDate = valueOrUndefined(formData.get('meetingDate'))

  const callDurationRaw = valueOrUndefined(formData.get('callDuration'))
  const callDuration =
    callDurationRaw === undefined ? undefined : Number(callDurationRaw)

  const attendeesRaw = valueOrUndefined(formData.get('attendees'))
  const attendees =
    attendeesRaw === undefined
      ? undefined
      : attendeesRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)

  return {
    leadId,
    type,
    notes,
    callDate,
    callDuration,
    meetingDate,
    attendees,
  }
}

function valueOrUndefined(v: FormDataEntryValue | null): string | undefined {
  if (v === null) return undefined
  const s = typeof v === 'string' ? v : ''
  const trimmed = s.trim()
  return trimmed === '' ? undefined : trimmed
}
