import { rehearsalResponse, readRehearsalBody } from '@/server/services/receptionist-rehearsal-http'
import { deleteRehearsal, getRehearsal, reviewRehearsal } from '@/server/services/receptionist-rehearsals'

type Context = { params: Promise<{ id: string }> }
export async function GET(_request: Request, context: Context) {
  return rehearsalResponse(async session => getRehearsal(session.organizationId, session.dbUser.id, (await context.params).id))
}
export async function PATCH(request: Request, context: Context) {
  return rehearsalResponse(async session => reviewRehearsal(session.organizationId, session.dbUser.id, (await context.params).id, await readRehearsalBody(request)))
}
export async function DELETE(_request: Request, context: Context) {
  return rehearsalResponse(async session => deleteRehearsal(session.organizationId, session.dbUser.id, (await context.params).id))
}
