import { FollowUpInbox } from '@/components/follow-ups/follow-up-inbox'
import { EmailSyncStatus } from '@/components/email/email-sync-status'
import { hasPermission } from '@/server/auth/permissions'
import { requireSession } from '@/server/auth/session'

export default async function FollowUpsPage(): Promise<React.JSX.Element> {
  const session = await requireSession()
  if (!hasPermission(session.dbUser, 'leads:read')) {
    return <div className="rounded-lg border bg-card p-6"><h1 className="text-lg font-semibold">Follow-up inbox</h1><p className="mt-2 text-sm text-muted-foreground">You don&apos;t have permission to view follow-ups in this organization.</p></div>
  }
  return <FollowUpInbox canWrite={hasPermission(session.dbUser, 'leads:write')}><EmailSyncStatus canWrite={hasPermission(session.dbUser, 'leads:write')} className="min-w-0 rounded-xl border bg-card p-4 sm:p-6" /></FollowUpInbox>
}
