import { outcomeResponse, readOutcomeQuery } from '@/server/services/callback-outcomes-http'
import { listCallbackOutcomeQueue } from '@/server/services/callback-outcomes'
export async function GET(request: Request) { return outcomeResponse(session => listCallbackOutcomeQueue(session.organizationId, session.dbUser.id, readOutcomeQuery(request))) }
