import { emailMatchBody, emailMatchHttp, emailMatchId } from '@/server/services/email-match-http'
import { resolveEmailMatch } from '@/server/services/email-match-review'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return emailMatchHttp(request, async session => resolveEmailMatch(session.organizationId, session.dbUser.id, emailMatchId((await context.params).id), await emailMatchBody(request)), true)
}
