import { getCallbackNotificationCount } from '@/server/services/callback-notifications'
import { notificationResponse } from '@/server/services/callback-notifications-http'
export function GET(): Promise<Response>
export function GET(request: Request): Promise<Response>

export async function GET(request?: Request) { return notificationResponse(session => request?.headers.get('X-Flowrish-Response-Targets') === '1' ? getCallbackNotificationCount(session.organizationId, session.dbUser.id, true) : getCallbackNotificationCount(session.organizationId, session.dbUser.id)) }
