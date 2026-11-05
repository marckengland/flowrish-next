import { reviewFollowUp } from '@/server/services/follow-ups'
import { followUpBody, followUpHttp, followUpId } from '@/server/services/follow-up-http'
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return followUpHttp(request, true, async session => { const id = followUpId((await context.params).id); return { data: await reviewFollowUp(session.organizationId, session.dbUser.id, id, await followUpBody(request)), canWrite: true } })
}
