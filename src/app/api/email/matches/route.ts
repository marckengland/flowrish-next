import { emailMatchHttp } from '@/server/services/email-match-http'
import { listEmailMatches } from '@/server/services/email-match-review'
export async function GET(request: Request) {
  return emailMatchHttp(request, session => listEmailMatches(session.organizationId, session.dbUser.id))
}
