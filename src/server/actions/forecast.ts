'use server'

import { revalidatePath } from 'next/cache'
import { ZodError, z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { submitForecast as submitForecastService } from '@/server/services/forecast'
import { createTenantPrisma } from '@/server/db/middleware'

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
  commitAmount: z.coerce.number().min(0, 'Commit amount must be non-negative'),
  notes: z
    .string()
    .transform((value) => value.trim())
    .optional(),
})

export type SubmitForecastResult =
  | { data: { id: string } }
  | { error: string }

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
  const session = await requireSession()
  requirePermission(session.dbUser, 'forecast:submit')

  try {
    const parsed = submitFormSchema.parse({
      period: formData.get('period'),
      commitAmount: formData.get('commitAmount'),
      notes: formData.get('notes') ?? undefined,
    })

    const notes =
      parsed.notes && parsed.notes.length > 0 ? parsed.notes : undefined

    const result = await submitForecastService(
      session.dbUser.id,
      session.organizationId,
      parsed.period,
      parsed.commitAmount,
      notes,
    )

    // Audit log: async, non-blocking.
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry
      .create({
        data: {
          userId: session.dbUser.id,
          action: 'CREATE',
          entityType: 'ForecastSubmission',
          entityId: result.id,
        } as any,
      })
      .catch((err) => {
        console.error('Audit log failed (submitForecast):', err)
      })

    revalidatePath('/forecast')
    return { data: result }
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return { error: err.errors[0]?.message ?? 'Validation failed' }
    }
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to submit forecast. Please try again.' }
  }
}
