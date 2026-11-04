import { redirect } from 'next/navigation'
import { getWorkspaceIdentity } from '@/server/auth/session'
import { WorkspaceBoundary } from '@/components/layout/workspace-boundary'
import { WorkspaceSwitcher } from '@/components/layout/workspace-switcher'

export default async function WorkspacesPage() {
  if (!(await getWorkspaceIdentity())) redirect('/login')
  return (
    <WorkspaceBoundary>
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-6 py-12">
        <h1 className="text-2xl font-semibold">Choose your business</h1>
        <p className="text-sm text-muted-foreground">
          Continue with a business you belong to. If a switch wasn’t confirmed
          or access changed, choose again to reload its current permissions.
        </p>
        <WorkspaceSwitcher />
        <a className="text-sm underline" href="/login">
          Back to sign in
        </a>
      </main>
    </WorkspaceBoundary>
  )
}
