import { isValidElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ submission: vi.fn(), metrics: vi.fn(), risk: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: async () => ({ organizationId: 'org', dbUser: { id: 'self', name: 'Practice Owner', teamMemberships: [{ role: { hierarchy: 1, permissions: [{ key: 'leads:read' }, { key: 'forecast:read' }] } }] } }) }))
vi.mock('@/server/db/client', () => ({ prisma: { forecastSubmission: { findFirst: m.submission }, organizationMember: { findMany: async () => [] } } }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ task: { findMany: async () => [] }, lead: { findMany: async () => [] } }) }))
vi.mock('@/server/services/dashboard', () => ({ getPipelineMetrics: async () => ({}) }))
vi.mock('@/server/services/forecast', () => ({ calculatePipelineMetrics: m.metrics, calculateWinRate: async () => 0, assessForecastRisk: m.risk }))
vi.mock('@/server/services/access', () => ({ getLeadAccessFilter: async () => ({ deletedAt: null }) }))
vi.mock('@/server/services/rhythm', () => ({ calculatePriorityScore: () => 1, getRhythmSnapshot: async () => new Map() }))
import Page from '@/app/(dashboard)/dashboard/page'

function findCommitPanel(node: ReactNode): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(findCommitPanel).find(Boolean)
  if (!isValidElement<{ items?: Array<{ value: string; content: { props: Record<string, unknown> } }>; children?: ReactNode }>(node)) return undefined
  if (node.props.items) return node.props.items.find(item => item.value === 'commit')?.content.props
  return findCommitPanel(node.props.children)
}
beforeEach(() => {
  vi.resetAllMocks()
  m.metrics.mockImplementation(async (_org, owner) => ({ totalPipeline: 200, weightedPipeline: 150, aiPredicted: owner ? 100 : 9999 }))
  m.risk.mockReturnValue('High Risk')
})
it('compares the current user commitment with owner-scoped metrics and keeps business headline totals separate', async () => {
  m.submission.mockResolvedValue({ commitAmount: 200, currency: 'USD', reportingTimezone: 'UTC', calculationVersion: 'usd-stage-v1', scope: 'OWNER' })
  const page = await Page({ searchParams: Promise.resolve({}) })
  expect(m.submission.mock.calls[0][0].where).toMatchObject({ organizationId: 'org', userId: 'self' })
  expect(m.metrics).toHaveBeenCalledWith('org', 'self')
  expect(findCommitPanel(page)).toMatchObject({ teamCommit: 200, aiPredicted: 100, risk: 'High Risk' })
  expect(m.risk).toHaveBeenCalledWith(200, 100)
})
it('does not classify or relabel a legacy commitment', async () => {
  m.submission.mockResolvedValue({ commitAmount: 200 })
  const page = await Page({ searchParams: Promise.resolve({}) })
  expect(findCommitPanel(page)).toMatchObject({ teamCommit: null, basisStatus: 'unverified', risk: null })
  expect(m.risk).not.toHaveBeenCalled()
})
