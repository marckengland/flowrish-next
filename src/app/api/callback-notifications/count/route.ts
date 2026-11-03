import { getCallbackNotificationCount } from '@/server/services/callback-notifications'
import { notificationResponse } from '@/server/services/callback-notifications-http'
export async function GET() { return notificationResponse(session => getCallbackNotificationCount(session.organizationId, session.dbUser.id)) }
