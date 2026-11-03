import { ReceptionistSetupWizard } from '@/components/settings/receptionist-setup-wizard'
import { hasPermission } from '@/server/auth/permissions'
import { requireSession } from '@/server/auth/session'
export default async function ReceptionistSetupPage(): Promise<React.JSX.Element> {
  const session = await requireSession()
  if (!hasPermission(session.dbUser, 'admin:settings')) return <div className="rounded-lg border bg-card p-6"><h1 className="text-lg font-semibold">Website receptionist setup</h1><p className="mt-2 text-sm text-muted-foreground">You need organization settings permission to set up your receptionist.</p></div>
  return <ReceptionistSetupWizard />
}
