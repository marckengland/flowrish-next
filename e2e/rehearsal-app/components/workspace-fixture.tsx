'use client'
import { useQuery } from '@tanstack/react-query'
import { WorkspaceBoundary } from '@/components/layout/workspace-boundary'
import { WorkspaceSwitcher } from '@/components/layout/workspace-switcher'

function Prospects() {
  const query = useQuery({
    queryKey: ['workspace-prospects'],
    queryFn: async () => {
      const response = await fetch('/api/mock/workspace-leads')
      if (!response.ok) throw new Error('Synthetic context changed')
      return response.json() as Promise<{ name: string }>
    },
    retry: false,
  })
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Prospects</h2>
      {query.data && <p>{query.data.name}</p>}
      <button
        className="rounded-lg border px-3 py-2"
        onClick={() => {
          void query.refetch()
        }}
      >
        Refresh prospects
      </button>
    </section>
  )
}
export function WorkspaceFixture({ id }: { id: string }) {
  const readOnly = id === '22222222-2222-4222-8222-222222222222'
  const name = readOnly ? 'Practice Clinic' : 'Practice Studio'
  return (
    <WorkspaceBoundary organizationId={id}>
      <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
        <div className="max-w-xs">
          <WorkspaceSwitcher organizationId={id} organizationName={name} />
        </div>
        <h1 className="text-2xl font-semibold">{name}</h1>
        <p>{readOnly ? 'Read-only business' : 'Business administrator'}</p>
        {!readOnly && (
          <button className="rounded-lg border px-3 py-2">Create lead</button>
        )}
        <Prospects />
      </main>
    </WorkspaceBoundary>
  )
}
export function WorkspaceRecoveryFixture() {
  return (
    <WorkspaceBoundary>
      <main className="mx-auto max-w-md space-y-5 px-6 py-12">
        <h1 className="text-2xl font-semibold">Choose your business</h1>
        <WorkspaceSwitcher />
      </main>
    </WorkspaceBoundary>
  )
}
