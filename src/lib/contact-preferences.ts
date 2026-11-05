import { z } from 'zod'
import { mailAddress } from './email-routing'
export const contactPreferenceInput = z.object({ action: z.enum(['block', 'unblock']), email: mailAddress, reason: z.string().trim().min(3).max(1000), expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict()
export const contactPreferences = z.object({ version: z.string().regex(/^[a-f0-9]{64}$/), canBlock: z.boolean(), canUnblock: z.boolean(), addresses: z.array(z.object({ email: mailAddress, blocked: z.boolean(), reason: z.string().nullable(), revision: z.number().int().nonnegative(), updatedById: z.string().nullable(), updatedAt: z.string().nullable() })).max(402) })
export type ContactPreferences = z.infer<typeof contactPreferences>
