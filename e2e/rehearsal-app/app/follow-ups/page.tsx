import Link from 'next/link'
import { needsCheckingEntry } from '@/lib/needs-checking-entry'
import { FollowUpInbox } from '@/components/follow-ups/follow-up-inbox'
import { EmailSyncStatus } from '@/components/email/email-sync-status'
import { coreIds } from '../../core-fixtures'
export default async function Page({ searchParams }: { searchParams: Promise<{ match?: string; reply?: string; readonly?: string; needsChecking?: string; status?: string; summary?: string }> }) {
  const query = await searchParams, targeted = Boolean(query.match || query.reply || query.needsChecking || query.summary)
  return <>{query.summary&&<nav aria-label="Synthetic summary entries"><Link href="/follow-ups?needsChecking=1&status=PENDING&summary=1" prefetch={false}>Dashboard summary Pending</Link><Link href="/follow-ups?needsChecking=1&status=APPROVED&summary=1" prefetch={false}>Dashboard summary Approved</Link></nav>}<FollowUpInbox initialSendStatusTab={query.readonly==='true'?undefined:needsCheckingEntry(query)} canWrite={query.readonly !== 'true'} {...(targeted ? { emailMatchContext: { organizationId: coreIds.organization, userId: coreIds.user }, initialMessageId: query.match, initialReplyId: query.reply } : {})}><EmailSyncStatus canWrite={query.readonly !== 'true'} /></FollowUpInbox></>
}
