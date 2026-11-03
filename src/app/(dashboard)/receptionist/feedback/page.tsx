import Link from 'next/link'
import { VisitorFeedbackInbox } from '@/components/receptionist/visitor-feedback'
import { AppError } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { callbackAccess } from '@/server/services/callback-access'
export default async function VisitorFeedbackPage(): Promise<React.JSX.Element> {
  const session = await requireSession(); let allowed = false
  try { allowed = (await callbackAccess(session.organizationId, session.dbUser.id)).admin }
  catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error }
  return <div key={`${session.organizationId}:${session.dbUser.id}`} className="mx-auto max-w-4xl space-y-6 pb-10"><header className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">Receptionist visitor feedback</h1><p className="text-sm text-muted-foreground">Review questions visitors explicitly saved, then create private FAQ drafts for your team to verify.</p><Link className="inline-flex min-h-11 items-center text-sm font-medium underline" href="/receptionist">Receptionist home</Link></header>{allowed ? <VisitorFeedbackInbox /> : <p role="alert" className="text-sm">Organization administrator access is required to view visitor feedback.</p>}</div>
}
