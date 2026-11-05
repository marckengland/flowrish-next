import { leadMergeBody, leadMergeHttp } from '@/server/services/lead-merge-http'
import { applyLeadMerge } from '@/server/services/lead-merge'
import { AppError } from '@/lib/errors'
import { leadMergeWritesEnabled } from '@/server/services/lead-merge-policy'
export async function POST(request: Request) {
  return leadMergeHttp(request, async session => {
    if (!leadMergeWritesEnabled()) throw new AppError('MERGE_DISABLED', 'Merge confirmation is temporarily unavailable. Keep your review and contact an administrator.', 503)
    return applyLeadMerge(session.organizationId, session.dbUser.id, await leadMergeBody(request))
  })
}
