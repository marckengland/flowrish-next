import Link from 'next/link'
import { PageHeader } from '@/components/layout/page-header'
import { LeadViewControls } from '@/components/leads/lead-view-controls'
import { LeadTable } from '@/components/leads/lead-table'
import { coreLead, coreStages, coreIds } from '../../core-fixtures'
export default async function Page({ searchParams }: { searchParams: Promise<{ viewScope?: string }> }) {
  const { viewScope } = await searchParams
  const organizationId = viewScope === 'other-workspace' ? '66666666-6666-4666-8666-666666666666' : coreIds.organization
  const userId = viewScope === 'other-user' ? '77777777-7777-4777-8777-777777777777' : coreIds.user
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Leads"
        actions={<Link href="/leads/new">New lead</Link>}
      />
      <LeadViewControls
        organizationId={organizationId}
        userId={userId}
        pipelineId="88888888-8888-4888-8888-888888888888"
        stages={coreStages.map((s) => ({ value: s.id, label: s.name }))}
        assignees={[{ value: userId, label: 'Practice Owner' }]}
      />
      <LeadTable
        initialData={{
          data: [coreLead()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }}
      />
    </div>
  )
}
