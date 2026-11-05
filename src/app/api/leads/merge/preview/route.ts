import { leadMergeBody, leadMergeHttp } from '@/server/services/lead-merge-http'
import { previewLeadMerge } from '@/server/services/lead-merge'
export async function POST(request: Request) {
  return leadMergeHttp(request, async session => {
    return previewLeadMerge(session.organizationId, session.dbUser.id, await leadMergeBody(request))
  })
}
