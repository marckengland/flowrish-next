import { z } from 'zod'
import { followUpBody, followUpHttp } from '@/server/services/follow-up-http'
import { changeContactPreference, readContactPreferences } from '@/server/services/contact-suppression'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  return followUpHttp(request, false, async session => { const id = z.string().uuid().parse((await context.params).id); const data = await readContactPreferences(session.organizationId, session.dbUser.id, id); return { data, canWrite: data.canBlock } })
}
export async function POST(request: Request, context: Context) {
  return followUpHttp(request, true, async session => { const id = z.string().uuid().parse((await context.params).id); const data = await changeContactPreference(session.organizationId, session.dbUser.id, id, await followUpBody(request)); return { data, canWrite: data.canBlock } })
}
