import { z } from 'zod'
export const EMAIL_NOTIFICATION_USER_HEADER = 'x-flowrish-email-notification-user'
export const EMAIL_NOTIFICATION_EVENT = 'flowrish:email-notifications-changed'
export const emailNotificationKey = z.string().regex(/^[a-f0-9]{64}$/)
export const emailNotificationQuery = z.object({ filter: z.enum(['unread', 'all']).default('unread'), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict()
export const emailNotificationRead = z.object({ read: z.literal(true) }).strict()
export const emailNotificationCount = z.object({ unread: z.number().int().nonnegative() }).strict()
export const emailNotificationRow = z.object({ key: emailNotificationKey, kind: z.enum(['email_reply', 'email_match']), messageId: z.string().uuid(), followUpId: z.string().uuid().nullable(), createdAt: z.string().datetime(), readAt: z.string().datetime().nullable() }).strict().refine(row => row.kind === 'email_reply' ? row.followUpId !== null : row.followUpId === null)
export const emailNotificationList = z.object({ rows: z.array(emailNotificationRow).max(20), page: z.number().int().min(1).max(10000), hasMore: z.boolean() }).strict()
export const emailNotificationAck = z.object({ key: emailNotificationKey, readAt: z.string().datetime() }).strict()
export type EmailNotification = z.infer<typeof emailNotificationRow>
export interface EmailNotificationContext { organizationId: string; userId: string }
export const emailNotificationTitle = (kind: EmailNotification['kind']) => kind === 'email_match' ? 'Email match needs review' : 'Email reply needs review'
export const emailNotificationHref = (row: EmailNotification) => row.kind === 'email_match' ? `/follow-ups?match=${row.messageId}#email-match-review` : `/follow-ups?reply=${row.followUpId}#follow-up-${row.followUpId}`
export function emailWaitingAge(createdAt: string, now = Date.now()) { const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60000)); return minutes < 1 ? 'Waiting less than a minute' : minutes < 60 ? `Waiting ${minutes} min` : minutes < 1440 ? `Waiting ${Math.floor(minutes / 60)} hr` : `Waiting ${Math.floor(minutes / 1440)} day(s)` }
export const emailNotificationDraftContext = z.object({ accountId: z.string(), provider: z.enum(['gmail', 'microsoft']), threadId: z.string(), recipientEmail: z.string().email(), mailboxEmail: z.string().email(), messageCount: z.number().int().positive(), lastMessageAt: z.string() })
export const focusedEmailReply = z.object({ id: z.string().uuid(), sourceType: z.literal('EMAIL'), sourceText: z.string(), title: z.string(), description: z.string(), draftSubject: z.string().nullable(), draftBody: z.string().nullable(), status: z.literal('PENDING'), taskId: z.string().uuid().nullable(), lead: z.object({ id: z.string().uuid(), firstName: z.string(), lastName: z.string(), email: z.string().nullable() }), createdAt: z.string().datetime(), draftGeneratedAt: z.string().datetime().nullable().optional(), draftVersion: z.string().nullable().optional(), draftContext: emailNotificationDraftContext.nullable().optional() })
