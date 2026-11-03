import { callbackNotificationQuery } from '@/lib/callback-notifications'
import { listCallbackNotifications } from '@/server/services/callback-notifications'
import { notificationQuery, notificationResponse } from '@/server/services/callback-notifications-http'
export async function GET(request: Request) { return notificationResponse(session => request.headers.get('X-Flowrish-Response-Targets') === '1' ? listCallbackNotifications(session.organizationId, session.dbUser.id, callbackNotificationQuery.parse(notificationQuery(request)), true) : listCallbackNotifications(session.organizationId, session.dbUser.id, callbackNotificationQuery.parse(notificationQuery(request)))) }
