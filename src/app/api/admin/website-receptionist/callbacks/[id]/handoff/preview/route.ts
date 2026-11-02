import { rehearsalResponse } from '@/server/services/receptionist-rehearsal-http'
import { readHandoffBody } from '@/server/services/callback-handoff-http'
import { previewCallbackHandoff } from '@/server/services/callback-handoff'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return rehearsalResponse(async session => previewCallbackHandoff(session.organizationId, session.dbUser.id, (await context.params).id, await readHandoffBody(request))) }
