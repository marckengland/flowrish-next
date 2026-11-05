import Link from 'next/link'
import { EmailsTab } from '@/components/leads/lead-emails'
import { LeadDetail } from '@/components/leads/lead-detail'
import { coreLead, coreStages } from '../../../core-fixtures'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ readonly?: string; mergeHistory?: string }>
}) {
  const params = await searchParams
  return (
    <div className="min-w-0 space-y-5">
      <h1>Lead</h1>
      <LeadDetail
        lead={coreLead()}
        stages={coreStages}
        canEdit={params.readonly !== 'true'}
      />
      {params.mergeHistory === 'true' && <EmailsTab leadId={coreLead().id} leadName="Practice" leadEmail={null} canWrite={false} />}
      <Link href="/tasks">Open task queue</Link>
      <Link className="ml-4" href="/follow-ups">
        Review follow-ups
      </Link>
    </div>
  )
}
