import { ReceptionistHome } from '@/components/receptionist/receptionist-home'
import { AppError } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { callbackAccess } from '@/server/services/callback-access'
export default async function ReceptionistPage(): Promise<React.JSX.Element> {
  const session = await requireSession(); let allowed = false
  try { const access = await callbackAccess(session.organizationId, session.dbUser.id); allowed = access.admin || access.crm }
  catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error }
  return <div key={`${session.organizationId}:${session.dbUser.id}`} className="mx-auto max-w-6xl space-y-6 pb-10"><header className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">Receptionist</h1><p className="text-sm text-muted-foreground">Your business’s website receptionist, callback work, and setup tools.</p></header>{allowed ? <ReceptionistHome /> : <p role="alert" className="text-sm">Settings or CRM permissions in the current organization are required to view Receptionist home.</p>}</div>
}
