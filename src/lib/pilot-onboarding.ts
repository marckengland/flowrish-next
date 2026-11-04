import { z } from 'zod'
import { waitlistEntrySchema } from './staff-waitlist'

export const PILOT_DAYS = 7
export const PILOT_COOKIE_NAME =
  process.env.NODE_ENV === 'production'
    ? '__Host-flowrish-pilot'
    : 'flowrish-pilot'
export const pilotTokenSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const pilotSessionSchema = z.object({ token: pilotTokenSchema }).strict()
export const pilotPreviewInputSchema = z
  .object({ expectedVersion: z.number().int().min(0) })
  .strict()
export const pilotIssueSchema = pilotPreviewInputSchema
  .extend({
    previewVersion: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.string().uuid(),
    confirmed: z.literal(true),
  })
  .strict()
export const pilotRevokeSchema = pilotPreviewInputSchema
  .extend({
    generation: z.number().int().positive(),
    confirmed: z.literal(true),
  })
  .strict()
export const pilotAcceptSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !value.includes('\0'), 'Use a valid business name.'),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    confirmed: z.literal(true),
  })
  .strict()
export const pilotInvitationSchema = z.object({
  generation: z.number().int().positive(),
  email: z.string().email(),
  state: z.enum(['active', 'expired', 'revoked', 'joined']),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
})
export const pilotStaffSchema = z.object({
  entry: waitlistEntrySchema,
  invitation: pilotInvitationSchema.nullable(),
})
export const pilotIssueResultSchema = pilotStaffSchema.extend({
  link: z.string().url().nullable(),
})
export const pilotPreviewSchema = z.object({
  version: z.string().regex(/^[a-f0-9]{64}$/),
  email: z.string().email(),
  expiresInDays: z.literal(7),
})
export const pilotStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('missing') }),
  z.object({ state: z.literal('sign_in') }),
  z.object({ state: z.literal('unavailable') }),
  z.object({ state: z.literal('existing_workspace') }),
  z.object({ state: z.literal('ready'), expiresAt: z.string().datetime() }),
  z.object({
    state: z.literal('joined'),
    organizationName: z.string(),
    continueHref: z.literal('/receptionist/setup').nullable(),
  }),
])
export type PilotStaffData = z.infer<typeof pilotStaffSchema>
export type PilotPreview = z.infer<typeof pilotPreviewSchema>
export type PilotStatus = z.infer<typeof pilotStatusSchema>

export function safeAuthNext(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return '/dashboard'
  try {
    const url = new URL(value, 'https://flowrish.invalid')
    return url.origin === 'https://flowrish.invalid'
      ? url.pathname + url.search + url.hash
      : '/dashboard'
  } catch {
    return '/dashboard'
  }
}
