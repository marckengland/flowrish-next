import { FollowUpInbox } from '@/components/follow-ups/follow-up-inbox'
import { WorkspaceIdentityProvider } from '@/components/layout/workspace-identity'
import { coreIds } from '../../core-fixtures'
export default function Page() {
  const context = { organizationId: coreIds.organization, userId: coreIds.user }
  return <WorkspaceIdentityProvider {...context}><FollowUpInbox canWrite emailMatchContext={context} /></WorkspaceIdentityProvider>
}
