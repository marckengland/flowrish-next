import { rehearsalResponse } from '@/server/services/receptionist-rehearsal-http'
import { getCallbackTaskSource } from '@/server/services/callback-handoff'
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { return rehearsalResponse(async session => getCallbackTaskSource(session.organizationId, session.dbUser.id, (await context.params).id)) }
