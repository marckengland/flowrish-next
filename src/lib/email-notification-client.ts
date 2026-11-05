'use client'
import { EMAIL_NOTIFICATION_USER_HEADER, type EmailNotificationContext } from './email-notifications'
import { WORKSPACE_HEADER } from './workspace-context'
export class EmailNotificationError extends Error { constructor(message: string, public status: number, public code: string) { super(message) } }
export const emailNotificationHeaders = (context: EmailNotificationContext) => ({ [WORKSPACE_HEADER]: context.organizationId, [EMAIL_NOTIFICATION_USER_HEADER]: context.userId })
export async function emailNotificationData(response: Response, context: EmailNotificationContext): Promise<unknown> {
  const value = await response.json()
  if (!response.ok) throw new EmailNotificationError(value.error?.message ?? 'Email notifications are unavailable.', response.status, value.error?.code ?? '')
  if (value.scope?.organizationId !== context.organizationId || value.scope?.userId !== context.userId) throw new EmailNotificationError('The account or business changed. Reload before continuing.', 409, 'EMAIL_NOTIFICATION_CONTEXT_CHANGED')
  return value.data as unknown
}
