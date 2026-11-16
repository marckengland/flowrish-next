'use client'
import { WorkspaceBoundary } from '@/components/layout/workspace-boundary'
import { WorkspaceIdentityProvider } from '@/components/layout/workspace-identity'
import { coreIds } from '../core-fixtures'
import { WorkspaceSwitcher } from '@/components/layout/workspace-switcher'
import { ReceptionistSetupWizard } from '@/components/settings/receptionist-setup-wizard'
import { CallbackHandoff } from '@/components/settings/callback-handoff'

export function ReceptionistWorkspaceFixture({ id, view }: { id: string; view: 'setup' | 'handoff' }) {
  const clinic = id === '22222222-2222-4222-8222-222222222222'
  return <WorkspaceBoundary organizationId={id}><WorkspaceIdentityProvider organizationId={id} userId={coreIds.user}><div className="space-y-6">
    <WorkspaceSwitcher organizationId={id} organizationName={clinic ? 'Practice Clinic' : 'Practice Studio'} />
    {view === 'setup' ? <ReceptionistSetupWizard /> : <><h1>Callback handoff</h1><CallbackHandoff callbackId={clinic ? '66666666-6666-4666-8666-666666666666' : '55555555-5555-4555-8555-555555555555'} /></>}
  </div></WorkspaceIdentityProvider></WorkspaceBoundary>
}
