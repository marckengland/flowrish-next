import { outcomeResponse, readOutcomeBody } from '@/server/services/callback-outcomes-http'
import { previewCallbackOutcome } from '@/server/services/callback-outcomes'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return outcomeResponse(async session => previewCallbackOutcome(session.organizationId, session.dbUser.id, (await context.params).id, await readOutcomeBody(request))) }
