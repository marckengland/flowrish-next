import { responsePolicyWriteSchema } from '@/lib/callback-response'
import { getCallbackResponsePolicy, saveCallbackResponsePolicy } from '@/server/services/callback-response'
import { notificationBody, notificationResponse } from '@/server/services/callback-notifications-http'
export async function GET() { return notificationResponse(session => getCallbackResponsePolicy(session.organizationId, session.dbUser.id)) }
export async function PUT(request: Request) { return notificationResponse(async session => saveCallbackResponsePolicy(session.organizationId, session.dbUser.id, responsePolicyWriteSchema.parse(await notificationBody(request)))) }
