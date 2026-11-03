import Link from 'next/link'
import { WebsiteReceptionistSettings } from '@/components/settings/website-receptionist-settings'
import { AppError } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { callbackAccess } from '@/server/services/callback-access'

export default async function ReceptionistCallbacksPage(): Promise<React.JSX.Element> {
  const session = await requireSession(); let allowed = false
  try { allowed = (await callbackAccess(session.organizationId, session.dbUser.id)).admin }
  catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error }
  return <div key={`${session.organizationId}:${session.dbUser.id}`} className="mx-auto max-w-4xl space-y-6 pb-10">
    <header className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">Receptionist callback inbox</h1><p className="max-w-2xl text-sm text-muted-foreground">Review confirmed website requests and prepare CRM handoffs. No call or message is sent here. CRM handoff also requires CRM and contacts access.</p><Link className="inline-flex min-h-11 items-center text-sm font-medium underline" href="/receptionist">Receptionist home</Link></header>
    {allowed ? <WebsiteReceptionistSettings callbacksOnly /> : <p role="alert" className="text-sm">Organization administrator access is required to view callback requests. CRM staff can open assigned callback work from Receptionist home.</p>}
  </div>
}
