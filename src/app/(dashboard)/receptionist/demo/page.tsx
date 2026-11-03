import { ReceptionistDemo } from '@/components/receptionist/receptionist-demo'
import { AppError } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { getReceptionistDemoBusiness } from '@/server/services/receptionist-demo'

export default async function ReceptionistDemoPage(): Promise<React.JSX.Element> {
  const session = await requireSession()
  try {
    const business = await getReceptionistDemoBusiness(session.organizationId, session.dbUser.id)
    return <div key={`${session.organizationId}:${session.dbUser.id}`} className="mx-auto max-w-6xl pb-10"><ReceptionistDemo business={business} /></div>
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== 403) throw error
    return <p role="alert" className="text-sm">Settings or CRM permissions in the current organization are required to use Demo mode.</p>
  }
}
