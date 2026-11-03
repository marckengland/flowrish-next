import { ResponsePolicyEditor } from '@/components/callbacks/response-policy-editor'
import { ResponseTargetQueue } from '@/components/callbacks/response-target-queue'
import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import Link from 'next/link'

export default async function ResponseTargetsPage(): Promise<React.JSX.Element> {
  const session = await requireSession()
  return <div key={`${session.organizationId}:${session.dbUser.id}`} className="mx-auto max-w-4xl space-y-6 pb-8"><header className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">Callback response targets</h1><p className="text-sm text-muted-foreground">Weekly business-hour deadlines and in-app escalation, with human approval for CRM work and contact.</p></header>{hasPermission(session.dbUser, 'admin:settings') && <><Link href="/callbacks/performance" className="inline-flex min-h-11 items-center text-sm font-medium underline">View receptionist performance</Link><ResponsePolicyEditor /></>}<ResponseTargetQueue /></div>
}
