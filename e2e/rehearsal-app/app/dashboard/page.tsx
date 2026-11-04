import Link from 'next/link'
import { cookies } from 'next/headers'
import { WorkspaceFixture } from '../../components/workspace-fixture'
import { PageHeader } from '@/components/layout/page-header'
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs'
import { TodaysRhythmPanel } from '@/components/dashboard/panels/todays-rhythm'
import { DealHealthPanel } from '@/components/dashboard/panels/deal-health'
import { coreTask, coreLead } from '../../core-fixtures'
export default async function Page() {
  const id = (await cookies()).get('mock_workspace')?.value
  if (id) return <WorkspaceFixture id={id} />
  const task = coreTask(),
    lead = coreLead()
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Dashboard"
        description="Synthetic core workflow audit"
        actions={<Link href="/leads/new">New lead</Link>}
      />
      <nav className="flex flex-wrap gap-5" aria-label="Core workflow">
        <Link href="/leads">Leads</Link>
        <Link href="/tasks">Tasks</Link>
        <Link href="/follow-ups">Follow-ups</Link>
      </nav>
      <DashboardTabs
        items={[
          {
            value: 'rhythm',
            label: "Today's Rhythm",
            content: (
              <TodaysRhythmPanel
                actions={[
                  {
                    id: task.id,
                    title: task.title,
                    dueDate: task.dueDate,
                    priorityScore: 60,
                    isOverdue: true,
                    leadId: lead.id,
                    leadName: 'Practice Prospect',
                  },
                ]}
                overdueCount={1}
                todayCount={1}
                openCount={1}
              />
            ),
          },
          {
            value: 'health',
            label: 'Deal Health',
            content: (
              <DealHealthPanel
                leads={[
                  {
                    leadId: lead.id,
                    leadName: 'Practice Prospect',
                    engagementScore: 60,
                    health: 'Healthy',
                    dealValue: 500,
                  },
                ]}
                summary={{ healthy: 1, atRisk: 0, critical: 0 }}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
