import Link from 'next/link'
import { PerformanceDashboard } from '@/components/callbacks/performance-dashboard'
import { requireSession } from '@/server/auth/session'
import { AppError } from '@/lib/errors'
import { callbackAccess } from '@/server/services/callback-access'
export default async function ReceptionistPerformancePage(): Promise<React.JSX.Element> {
  const session = await requireSession()
  let allowed = false
  try {
    const access = await callbackAccess(session.organizationId, session.dbUser.id)
    allowed = access.admin && access.crm
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== 403) throw error
  }
  return <div key={`${session.organizationId}:${session.dbUser.id}`} className="mx-auto max-w-6xl space-y-6 pb-10"><header className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">Receptionist performance</h1><p className="text-sm text-muted-foreground">Follow confirmed callback requests through approved CRM handoff, recorded contact and closure.</p><Link className="inline-flex min-h-11 items-center text-sm font-medium underline" href="/receptionist">Receptionist home</Link><Link className="inline-flex min-h-11 items-center text-sm font-medium underline" href="/settings?section=receptionist">Receptionist settings</Link></header>{allowed ? <PerformanceDashboard /> : <p role="alert" className="text-sm">Settings and CRM permissions are required to view this report.</p>}</div>
}
