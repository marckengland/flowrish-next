import { savedFollowUpViewIdSchema } from '@/lib/saved-follow-up-views'
import { followUpHttp } from '@/server/services/follow-up-http'
import { savedViewBody } from '@/server/services/saved-lead-view-http'
import { deleteSavedFollowUpView, updateSavedFollowUpView } from '@/server/services/saved-follow-up-views'

type Context = { params: Promise<{ id: string }> }
export async function PATCH(request: Request, context: Context) {
  return followUpHttp(request, false, async session => ({ data: await updateSavedFollowUpView(session.organizationId, session.dbUser.id, savedFollowUpViewIdSchema.parse((await context.params).id), await savedViewBody(request)), canWrite: false }))
}
export async function DELETE(request: Request, context: Context) {
  return followUpHttp(request, false, async session => ({ data: await deleteSavedFollowUpView(session.organizationId, session.dbUser.id, savedFollowUpViewIdSchema.parse((await context.params).id), await savedViewBody(request)), canWrite: false }))
}
