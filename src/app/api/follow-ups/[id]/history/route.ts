import { listFollowUpHistory } from '@/server/services/follow-up-history'
import { followUpHttp, followUpId } from '@/server/services/follow-up-http'
export async function GET(request: Request, context: { params: Promise<{id:string}> }) {
  return followUpHttp(request,false,async session => listFollowUpHistory(session.organizationId,session.dbUser.id,followUpId((await context.params).id),Object.fromEntries(new URL(request.url).searchParams)))
}
