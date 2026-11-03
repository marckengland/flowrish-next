import { responseTargetQuerySchema } from '@/lib/callback-response'
import { listCallbackResponseTargets } from '@/server/services/callback-response'
import { notificationQuery, notificationResponse } from '@/server/services/callback-notifications-http'
export async function GET(request: Request) { return notificationResponse(session => listCallbackResponseTargets(session.organizationId, session.dbUser.id, responseTargetQuerySchema.parse(notificationQuery(request)))) }
