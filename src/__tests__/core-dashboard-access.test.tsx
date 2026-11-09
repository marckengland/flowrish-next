import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  metrics: vi.fn(),
  forecast: vi.fn(),
  win: vi.fn(),
  access: vi.fn(),
  rhythm: vi.fn(),
  task: vi.fn(),
  lead: vi.fn(),
}))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: () => ({
    task: { findMany: mocks.task },
    lead: { findMany: mocks.lead },
  }),
}))
vi.mock('@/server/db/client', () => ({ prisma: {} }))
vi.mock('@/server/services/dashboard', () => ({
  getPipelineMetrics: mocks.metrics,
}))
vi.mock('@/server/services/forecast', () => ({
  calculatePipelineMetrics: mocks.forecast,
  calculateWinRate: mocks.win,
  assessForecastRisk: vi.fn(),
}))
vi.mock('@/server/services/access', () => ({
  getLeadAccessFilter: mocks.access,
}))
vi.mock('@/server/services/rhythm', () => ({
  calculatePriorityScore: () => 1,
  getRhythmSnapshot: mocks.rhythm,
}))
vi.mock('@/components/dashboard/dashboard-tabs', () => ({
  DashboardTabs: ({
    items,
  }: {
    items: Array<{
      value: string
      label: string
      visible?: boolean
      content: React.ReactNode
    }>
  }) => (
    <div>
      {items
        .filter((i) => i.visible !== false)
        .map((i) => (
          <section key={i.value}>
            <h2>{i.label}</h2>
            {i.content}
          </section>
        ))}
    </div>
  ),
}))
vi.mock('@/components/dashboard/panels/pipeline-metrics', () => ({
  PipelineMetricsPanel: () => null,
}))
vi.mock('@/components/dashboard/panels/forecast', () => ({
  ForecastPanel: () => null,
}))
vi.mock('@/components/dashboard/panels/deal-health', () => ({
  DealHealthPanel: () => null,
}))
vi.mock('@/components/dashboard/panels/deal-gaps', () => ({
  DealGapsPanel: () => null,
}))
vi.mock('@/components/dashboard/panels/todays-rhythm', () => ({
  TodaysRhythmPanel: () => null,
}))
vi.mock('@/components/dashboard/panels/team-view', () => ({
  TeamViewPanel: () => null,
}))
vi.mock('@/components/dashboard/panels/commit-vs-ai', () => ({
  CommitVsAiPanel: () => null,
}))
import DashboardPage from '@/app/(dashboard)/dashboard/page'
const user = (permissions: string[]) => ({
  id: 'member',
  teamMemberships: [
    {
      role: { hierarchy: 3, permissions: permissions.map((key) => ({ key })) },
    },
  ],
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({
    organizationId: 'org',
    dbUser: user(['leads:read']),
  })
  mocks.metrics.mockResolvedValue({})
  mocks.forecast.mockResolvedValue({
    totalPipeline: 0,
    weightedPipeline: 0,
    aiPredicted: 0,
  })
  mocks.win.mockResolvedValue(0)
  mocks.task.mockResolvedValue([])
  mocks.lead.mockResolvedValue([])
  mocks.rhythm.mockResolvedValue(new Map())
  mocks.access.mockResolvedValue({ deletedAt: null, assignedUserId: 'member' })
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({scope:{organizationId:'org',userId:'member'},capabilities:{canWrite:true},data:{counts:{PENDING:0,APPROVED:0,DISMISSED:0,SNOOZED:0},overdueTasks:0,checkedAt:new Date().toISOString(),filters:{search:'',source:'ALL',dueOnly:false,needsChecking:true}}}))))
})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('denies dashboard data before any business query when leads read is absent', async () => {
  mocks.session.mockResolvedValue({ organizationId: 'org', dbUser: user([]) })
  render(await DashboardPage({}))
  expect(screen.getByText(/permission to view.*dashboard/i)).toBeInTheDocument()
  for (const fn of [
    mocks.metrics,
    mocks.forecast,
    mocks.win,
    mocks.task,
    mocks.lead,
    mocks.rhythm,
  ])
    expect(fn).not.toHaveBeenCalled()
})
it('scopes detailed deal rows with the same access filter as the leads page', async () => {
  render(await DashboardPage({}))
  expect(mocks.access).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'member' }),
    'org',
  )
  expect(mocks.lead).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        assignedUserId: 'member',
        isClosed: false,
        deletedAt: null,
      }),
    }),
  )
})
it('hides lead creation for read-only users and removes the inert month control', async () => {
  render(await DashboardPage({}))
  expect(
    screen.queryByRole('link', { name: 'New lead' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'This month' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: 'Team View' }),
  ).not.toBeInTheDocument()
})
it('keeps authorized lead creation available', async () => {
  mocks.session.mockResolvedValue({
    organizationId: 'org',
    dbUser: user(['leads:read', 'leads:write']),
  })
  render(await DashboardPage({}))
  expect(screen.getByRole('link', { name: 'New lead' })).toHaveAttribute(
    'href',
    '/leads/new',
  )
  await screen.findByText('No email sends need checking.')
})
it('places a scoped Needs checking summary on the writable dashboard',async()=>{
 mocks.session.mockResolvedValue({organizationId:'org',dbUser:user(['leads:read','leads:write'])})
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({scope:{organizationId:'org',userId:'member'},capabilities:{canWrite:true},data:{counts:{PENDING:4,APPROVED:0,DISMISSED:0,SNOOZED:0},overdueTasks:0,checkedAt:new Date().toISOString(),filters:{search:'',source:'ALL',dueOnly:false,needsChecking:true}}})))
 render(await DashboardPage({}));await screen.findByText('4 email sends need checking');expect(screen.getByRole('link',{name:'Pending (4)'})).toHaveAttribute('href','/follow-ups?needsChecking=1&status=PENDING');expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({'x-flowrish-workspace':'org','x-flowrish-follow-up-scope':'["org","member"]'});vi.restoreAllMocks()
})
