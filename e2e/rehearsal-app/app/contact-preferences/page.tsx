import { ContactPreferencesPanel } from '@/components/leads/contact-preferences'
import { WorkspaceIdentityProvider } from '@/components/layout/workspace-identity'
import { coreIds } from '../../core-fixtures'
export default function Page() {
  const context = { organizationId: coreIds.organization, userId: coreIds.user }
  return <main className="mx-auto w-full max-w-3xl p-4"><h1 className="mb-5 text-2xl font-semibold">Practice Clinic</h1><WorkspaceIdentityProvider {...context}><ContactPreferencesPanel leadId={coreIds.lead} context={context} /></WorkspaceIdentityProvider></main>
}
