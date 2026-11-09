import { z } from 'zod'
import { needsCheckingEntry } from '@/lib/needs-checking-entry'
import { FollowUpInbox } from '@/components/follow-ups/follow-up-inbox'
import { EmailSyncStatus } from '@/components/email/email-sync-status'
import { hasPermission } from '@/server/auth/permissions'
import { requireSession } from '@/server/auth/session'

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ match?: string | string[]; reply?: string | string[]; needsChecking?: string | string[]; status?: string | string[] }> }): Promise<React.JSX.Element> {
  const session = await requireSession()
  if (!hasPermission(session.dbUser, 'leads:read')) {
    return <div className="rounded-lg border bg-card p-6"><h1 className="text-lg font-semibold">Follow-up inbox</h1><p className="mt-2 text-sm text-muted-foreground">You don&apos;t have permission to view follow-ups in this organization.</p></div>
  }
  const requested = await searchParams
  const match = z.string().uuid().safeParse(requested.match), reply = z.string().uuid().safeParse(requested.reply)
  return <FollowUpInbox key={`${session.organizationId}:${session.dbUser.id}`} initialSendStatusTab={hasPermission(session.dbUser, 'leads:write') ? needsCheckingEntry(requested) : undefined} initialMessageId={match.success ? match.data : undefined} initialReplyId={reply.success ? reply.data : undefined} emailMatchContext={{ organizationId: session.organizationId, userId: session.dbUser.id }} canWrite={hasPermission(session.dbUser, 'leads:write')}><EmailSyncStatus canWrite={hasPermission(session.dbUser, 'leads:write')} className="min-w-0 rounded-xl border bg-card p-4 sm:p-6" /></FollowUpInbox>
}
