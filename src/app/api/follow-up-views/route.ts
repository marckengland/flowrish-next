import { AppError } from '@/lib/errors'
import { followUpHttp } from '@/server/services/follow-up-http'
import { savedViewBody } from '@/server/services/saved-lead-view-http'
import { createSavedFollowUpView, listSavedFollowUpViews } from '@/server/services/saved-follow-up-views'

export async function GET(request: Request) {
  return followUpHttp(request, false, async session => {
    if (new URL(request.url).search) throw new AppError('VALIDATION_ERROR', 'Saved views use your current business and account.', 400)
    return { data: await listSavedFollowUpViews(session.organizationId, session.dbUser.id), canWrite: false }
  })
}
export async function POST(request: Request) {
  return followUpHttp(request, false, async session => ({ data: await createSavedFollowUpView(session.organizationId, session.dbUser.id, await savedViewBody(request)), canWrite: false }))
}
