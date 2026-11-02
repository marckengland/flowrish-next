import { rehearsalResponse } from '@/server/services/receptionist-rehearsal-http'
import { readHandoffBody } from '@/server/services/callback-handoff-http'
import { getCallbackHandoffOptions, commitCallbackHandoff } from '@/server/services/callback-handoff'
type Context = { params: Promise<{ id: string }> }
export async function GET(_request: Request, context: Context) { return rehearsalResponse(async session => getCallbackHandoffOptions(session.organizationId, session.dbUser.id, (await context.params).id)) }
export async function POST(request: Request, context: Context) { return rehearsalResponse(async session => commitCallbackHandoff(session.organizationId, session.dbUser.id, (await context.params).id, await readHandoffBody(request))) }
