'use server'

import { revalidatePath } from 'next/cache'
import { ZodError, z } from 'zod'

import { fieldErrorsFromZod } from '@/server/actions/field-errors'

import { requireSession } from '@/server/auth/session'
import { MAX_MONEY_AMOUNT } from '@/lib/money'
import { requireEntitlement } from '@/server/auth/entitlements'
import { requirePermission } from '@/server/auth/permissions'
import { submitForecast as submitForecastService } from '@/server/services/forecast'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'

/**
 * Server Action form wrapper for submitting a forecast commit.
 *
 * Mirrors the pattern used by the other Server Actions in this
 * codebase — authenticate, authorise, validate, call the service,
 * write an audit log, then revalidate the forecast page.
 *
 * Validates: Requirement 10.2
 */

const submitFormSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'Period must be in YYYY-MM format'),
  commitAmount: z.preprocess(value => value === null || (typeof value === 'string' && !value.trim()) ? undefined : value, z.coerce.number().finite().min(0, 'Commit amount must be non-negative').max(MAX_MONEY_AMOUNT)),
  notes: z
    .string()
    .transform((value) => value.trim())
    .optional(),
})

export type SubmitForecastResult =
  | { data: { id: string } }
  | { error: string; fieldErrors?: Record<string, string>; uncertain?: boolean }

/**
 * Submits (or updates) a forecast commit for the given period.
 *
 * Accepts form data with fields:
 * - `period` (YYYY-MM, required)
 * - `commitAmount` (non-negative number, required)
 * - `notes` (optional string)
 */
export async function submitForecast(
  formData: FormData,
): Promise<SubmitForecastResult> {
  let saving = false
  let receipt: { id: string } | undefined
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'forecast:submit')
    await requireEntitlement(session.organizationId, 'forecasting')
    const parsed = submitFormSchema.parse({
      period: formData.get('period'),
      commitAmount: formData.get('commitAmount'),
      notes: formData.get('notes') ?? undefined,
    })

    const notes =
      parsed.notes && parsed.notes.length > 0 ? parsed.notes : undefined

    saving = true
    const result = await submitForecastService(
      session.dbUser.id,
      session.organizationId,
      parsed.period,
      parsed.commitAmount,
      notes,
    )

    receipt = result
    // Audit log: async, non-blocking.
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry
      .create({
        data: tenantData({
          userId: session.dbUser.id,
          action: 'CREATE',
          entityType: 'ForecastSubmission',
          entityId: result.id,
        }),
      })
      .catch(() => {
        console.error('Audit log failed (submitForecast)')
      })

    revalidatePath('/forecast')
    return { data: result }
  } catch (err: unknown) {
    // A failed refresh cannot undo a confirmed save or invite a duplicate retry.
    if (receipt) return { data: receipt }
    if (saving) return { error: 'Could not confirm the forecast submission. Reload before submitting again.', uncertain: true }
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
    return { error: 'Failed to submit forecast. Please try again.' }
  }
}
