import { emailNotificationKey, emailNotificationRead } from '@/lib/email-notifications'
import { readEmailNotification } from '@/server/services/email-notifications'
import { emailNotificationBody, emailNotificationHttp } from '@/server/services/email-notification-http'
export async function PATCH(request: Request, context: { params: Promise<{ key: string }> }) {
  return emailNotificationHttp(request, async session => { const key = emailNotificationKey.parse((await context.params).key); emailNotificationRead.parse(await emailNotificationBody(request)); return readEmailNotification(session.organizationId, session.dbUser.id, key) })
}
