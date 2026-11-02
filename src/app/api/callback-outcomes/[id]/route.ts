import { outcomeResponse, readOutcomeQuery, readOutcomeBody } from '@/server/services/callback-outcomes-http'
import { getCallbackOutcome, recordCallbackOutcome } from '@/server/services/callback-outcomes'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) { return outcomeResponse(async session => getCallbackOutcome(session.organizationId, session.dbUser.id, (await context.params).id, readOutcomeQuery(request))) }
export async function POST(request: Request, context: Context) { return outcomeResponse(async session => recordCallbackOutcome(session.organizationId, session.dbUser.id, (await context.params).id, await readOutcomeBody(request))) }
