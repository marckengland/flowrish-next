import { callbackNotificationKey, callbackNotificationRead } from '@/lib/callback-notifications'
import { readCallbackNotification } from '@/server/services/callback-notifications'
import { notificationBody, notificationResponse } from '@/server/services/callback-notifications-http'
export async function PATCH(request: Request, context: { params: Promise<{ key: string }> }) {
  return notificationResponse(async session => { const key = callbackNotificationKey.parse((await context.params).key); callbackNotificationRead.parse(await notificationBody(request)); return readCallbackNotification(session.organizationId, session.dbUser.id, key) })
}
