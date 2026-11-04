import Link from 'next/link'
import { PageHeader } from '@/components/layout/page-header'
import { LeadFilters } from '@/components/leads/lead-filters'
import { LeadTable } from '@/components/leads/lead-table'
import { coreLead, coreStages, coreIds } from '../../core-fixtures'
export default function Page() {
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Leads"
        actions={<Link href="/leads/new">New lead</Link>}
      />
      <LeadFilters
        stages={coreStages.map((s) => ({ value: s.id, label: s.name }))}
        assignees={[{ value: coreIds.user, label: 'Practice Owner' }]}
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
