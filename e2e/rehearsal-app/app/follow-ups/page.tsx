import { FollowUpInbox } from '@/components/follow-ups/follow-up-inbox'
import { EmailSyncStatus } from '@/components/email/email-sync-status'
export default function Page() {
  return (
    <FollowUpInbox canWrite>
      <EmailSyncStatus canWrite />
    </FollowUpInbox>
  )
}
