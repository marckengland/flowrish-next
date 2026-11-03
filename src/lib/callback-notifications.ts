import { z } from 'zod'
export const callbackNotificationKey = z.string().regex(/^[a-f0-9]{64}$/)
export const callbackNotificationQuery = z.object({ filter: z.enum(['unread', 'all']).default('unread'), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict()
export const callbackNotificationRead = z.object({ read: z.literal(true) }).strict()
export const callbackNotificationCount = z.object({ unread: z.number().int().nonnegative() }).strict()
export const callbackNotificationRow = z.object({ key: callbackNotificationKey, kind: z.enum(['new_callback', 'assigned', 'overdue']), callbackId: z.string().uuid(), taskId: z.string().uuid().nullable(), dueDate: z.string().datetime().nullable(), createdAt: z.string().datetime(), readAt: z.string().datetime().nullable() }).strict().superRefine((row, ctx) => {
  if (row.kind === 'new_callback' ? row.taskId !== null || row.dueDate !== null : row.taskId === null || row.dueDate === null) ctx.addIssue({ code: 'custom', message: 'Unexpected notification target.' })
})
export const callbackNotificationList = z.object({ rows: z.array(callbackNotificationRow).max(20), page: z.number().int().min(1).max(10000), hasMore: z.boolean() }).strict()
export const callbackNotificationAck = z.object({ key: callbackNotificationKey, readAt: z.string().datetime() }).strict()
export type CallbackNotification = z.infer<typeof callbackNotificationRow>
export type CallbackNotificationList = z.infer<typeof callbackNotificationList>
export const notificationTitle = (kind: CallbackNotification['kind']) => ({ new_callback: 'New callback request', assigned: 'Callback work assigned to you', overdue: 'Callback deadline overdue' })[kind]
export const notificationHref = (row: CallbackNotification) => row.kind === 'new_callback' ? '/settings?section=receptionist' : `/tasks/${row.taskId}`
