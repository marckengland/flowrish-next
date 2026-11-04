import { AppError } from '@/lib/errors'
import { savedViewBody, savedViewResponse } from '@/server/services/saved-lead-view-http'
import { createSavedLeadView, listSavedLeadViews } from '@/server/services/saved-lead-views'

export async function GET(request: Request) {
  return savedViewResponse(request, session => {
    if (new URL(request.url).search) throw new AppError('VALIDATION_ERROR', 'Saved views do not accept query filters.', 400)
    return listSavedLeadViews(session.organizationId, session.dbUser.id)
  })
}
export async function POST(request: Request) {
  return savedViewResponse(request, async session => createSavedLeadView(session.organizationId, session.dbUser.id, await savedViewBody(request)))
}
