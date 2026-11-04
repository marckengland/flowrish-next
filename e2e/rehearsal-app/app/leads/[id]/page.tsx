import Link from 'next/link'
import { LeadDetail } from '@/components/leads/lead-detail'
import { coreLead, coreStages } from '../../../core-fixtures'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ readonly?: string }>
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
      <Link href="/tasks">Open task queue</Link>
      <Link className="ml-4" href="/follow-ups">
        Review follow-ups
      </Link>
    </div>
  )
}
