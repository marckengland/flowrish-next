import { FollowUpInbox } from '@/components/follow-ups/follow-up-inbox'
import { EmailSyncStatus } from '@/components/email/email-sync-status'
import { coreIds } from '../../core-fixtures'
export default async function Page({ searchParams }: { searchParams: Promise<{ match?: string; reply?: string; readonly?: string }> }) {
  const query = await searchParams, targeted = Boolean(query.match || query.reply)
  return <FollowUpInbox canWrite={query.readonly !== 'true'} {...(targeted ? { emailMatchContext: { organizationId: coreIds.organization, userId: coreIds.user }, initialMessageId: query.match, initialReplyId: query.reply } : {})}><EmailSyncStatus canWrite={query.readonly !== 'true'} /></FollowUpInbox>
}
