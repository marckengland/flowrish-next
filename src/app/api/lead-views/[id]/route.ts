import { savedLeadViewIdSchema } from '@/lib/saved-lead-views'
import { savedViewBody, savedViewResponse } from '@/server/services/saved-lead-view-http'
import { deleteSavedLeadView, updateSavedLeadView } from '@/server/services/saved-lead-views'
type Context = { params: Promise<{ id: string }> }
export async function PATCH(request: Request, context: Context) {
  return savedViewResponse(request, async session => updateSavedLeadView(session.organizationId, session.dbUser.id, savedLeadViewIdSchema.parse((await context.params).id), await savedViewBody(request)))
}
export async function DELETE(request: Request, context: Context) {
  return savedViewResponse(request, async session => deleteSavedLeadView(session.organizationId, session.dbUser.id, savedLeadViewIdSchema.parse((await context.params).id), await savedViewBody(request)))
}
