import { FollowUpInbox } from '@/components/follow-ups/follow-up-inbox'
import { coreIds } from '../../core-fixtures'
export default async function Page({ searchParams }: { searchParams: Promise<{ readonly?: string }> }) {
  return <FollowUpInbox canWrite={(await searchParams).readonly !== 'true'} emailMatchContext={{ organizationId: coreIds.organization, userId: coreIds.user }} />
}
