import { z } from 'zod'
import { emailMatchBody, emailMatchHttp, emailMatchId } from '@/server/services/email-match-http'
import { previewEmailMatch } from '@/server/services/email-match-review'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return emailMatchHttp(request, async session => {
    z.object({}).strict().parse(await emailMatchBody(request))
    return previewEmailMatch(session.organizationId, session.dbUser.id, emailMatchId((await context.params).id))
  })
}
