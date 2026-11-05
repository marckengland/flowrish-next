import { z } from 'zod'
export const EMAIL_MATCH_USER_HEADER = 'x-flowrish-mail-match-user'
export const normalizeEmail = (value: string) => value.trim().toLowerCase()
export const mailAddress = z.string().trim().toLowerCase().email().max(320)
export const emailMatchAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link'), requestId: z.string().uuid(), expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), leadId: z.string().uuid(), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('dismiss'), requestId: z.string().uuid(), expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict(),
])
export const emailMatchResult = z.object({ messageId: z.string().uuid(), requestId: z.string().uuid(), action: z.enum(['link', 'dismiss']), leadId: z.string().nullable(), stopped: z.number().int().nonnegative(), suggestionCreated: z.boolean() }).strict()
export const routingState = z.object({
  state: z.enum(['PENDING', 'ROUTED', 'UNMATCHED', 'DISMISSED']), reason: z.enum(['AMBIGUOUS', 'UNAVAILABLE', 'LIMIT', 'PAUSED', 'EXISTING_LINK']).optional(),
  ownerId: z.string().min(1), mailboxEmail: mailAddress, provider: z.enum(['gmail', 'microsoft']), address: z.string().max(320),
  leadId: z.string().optional(), mode: z.enum(['AUTO', 'MANUAL']).optional(), at: z.string().datetime(),
  receipt: z.object({ requestId: z.string().uuid(), expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), action: z.enum(['link', 'dismiss']), selectedLeadId: z.string().optional(), result: emailMatchResult }).strict().optional(),
}).strict()
export const emailMatchListItem = z.object({ id: z.string().uuid(), fromEmail: z.string(), subject: z.string(), bodyPreview: z.string().nullable(), sentAt: z.string().datetime(), mailboxEmail: z.string(), reason: z.string() }).strict()
export const emailMatchPreview = z.object({ message: emailMatchListItem, version: z.string().regex(/^[a-f0-9]{64}$/), candidates: z.array(z.object({ id: z.string().uuid(), label: z.string(), email: z.string().nullable(), canLink: z.boolean(), viaArchive: z.boolean() }).strict()).max(20), restrictedMatches: z.boolean(), blocked: z.boolean() }).strict()
export type RoutingState = z.infer<typeof routingState>
export type EmailMatchAction = z.infer<typeof emailMatchAction>
export type EmailMatchPreview = z.infer<typeof emailMatchPreview>
export type EmailMatchResult = z.infer<typeof emailMatchResult>
