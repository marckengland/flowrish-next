import { rehearsalResponse } from '@/server/services/receptionist-rehearsal-http'
import { readWebsiteBody } from '@/server/services/website-receptionist-http'
import { reviewWebsiteCallback, deleteWebsiteCallback } from '@/server/services/website-receptionist'
type Context = { params: Promise<{ id: string }> }
export async function PATCH(request: Request, context: Context) { return rehearsalResponse(async session => reviewWebsiteCallback(session.organizationId, session.dbUser.id, (await context.params).id, await readWebsiteBody(request))) }
export async function DELETE(_request: Request, context: Context) { return rehearsalResponse(async session => deleteWebsiteCallback(session.organizationId, session.dbUser.id, (await context.params).id)) }
