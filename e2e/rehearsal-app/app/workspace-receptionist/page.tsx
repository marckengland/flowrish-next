import { cookies } from 'next/headers'
import { ReceptionistWorkspaceFixture } from '../../components/workspace-receptionist-fixture'
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const chosen = (await cookies()).get('mock_workspace')?.value
  const id = chosen === '22222222-2222-4222-8222-222222222222' ? chosen : '11111111-1111-4111-8111-111111111111'
  return <ReceptionistWorkspaceFixture id={id} view={(await searchParams).view === 'handoff' ? 'handoff' : 'setup'} />
}
