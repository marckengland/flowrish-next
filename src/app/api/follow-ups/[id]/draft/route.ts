import { z } from 'zod'
import { generateFollowUpDraft } from '@/server/services/follow-up-drafts'
import { followUpBody, followUpHttp } from '@/server/services/follow-up-http'
export const maxDuration = 120
const bodySchema = z.object({ instructions: z.string().max(2000).optional() })
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return followUpHttp(request, true, async session => { const id = z.string().uuid().parse((await context.params).id), body = bodySchema.parse(await followUpBody(request)); return { data: await generateFollowUpDraft(session.organizationId, session.dbUser.id, id, body.instructions), canWrite: true } })
}
