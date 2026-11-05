import { changeFollowUpSnooze } from '@/server/services/follow-up-snooze'
import { followUpBody, followUpHttp, followUpId } from '@/server/services/follow-up-http'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return followUpHttp(request, true, async session => ({ data: await changeFollowUpSnooze(session.organizationId, session.dbUser.id, followUpId((await context.params).id), await followUpBody(request)), canWrite: true }))
}
