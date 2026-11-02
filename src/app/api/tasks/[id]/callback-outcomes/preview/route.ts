import { outcomeResponse, readOutcomeBody } from '@/server/services/callback-outcomes-http'
import { resolveCallbackOutcomeTask, previewCallbackOutcome } from '@/server/services/callback-outcomes'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return outcomeResponse(async session => { const body = await readOutcomeBody(request); return previewCallbackOutcome(session.organizationId, session.dbUser.id, await resolveCallbackOutcomeTask(session.organizationId, session.dbUser.id, (await context.params).id), body) }) }
