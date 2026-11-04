import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ submissions: vi.fn(), snapshots: vi.fn(), actual: vi.fn(), create: vi.fn(), leads: vi.fn() }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ forecastSubmission: { findMany: m.submissions, create: m.create }, forecastSnapshot: { findMany: m.snapshots }, lead: { aggregate: m.actual, findMany: m.leads } }) }))
import { getForecastHistory } from '../forecast-history'
import { calculatePipelineMetrics, submitForecast } from '../forecast'
const basis = { currency: 'USD', reportingTimezone: 'UTC', calculationVersion: 'usd-stage-v1', scope: 'OWNER' }
const now = new Date('2026-12-01T00:30:00+08:00')
beforeEach(() => {
  vi.resetAllMocks()
  m.submissions.mockResolvedValue([]); m.snapshots.mockResolvedValue([])
  m.actual.mockResolvedValue({ _sum: { dealValue: null } }); m.create.mockResolvedValue({ id: 'saved' }); m.leads.mockResolvedValue([])
})
it('records owner metadata server-side and scopes both pipeline calculations to that owner', async () => {
  await submitForecast('self', 'org', '2026-11', 100)
  expect(m.create.mock.calls[0][0].data).toMatchObject({ userId: 'self', period: '2026-11', ...basis })
  await calculatePipelineMetrics('org', 'self')
  for (const [args] of m.leads.mock.calls) expect(args.where).toMatchObject({ assignedUserId: 'self', currency: 'USD' })
})
it('uses six UTC months with inclusive start and exclusive end and explicit tenant/owner/closed-won filters', async () => {
  const report = await getForecastHistory('org', 'self', now)
  expect(report.months.map(row => row.period)).toEqual(['2026-11', '2026-10', '2026-09', '2026-08', '2026-07', '2026-06'])
  expect(report.months[0].inProgress).toBe(true); expect(report.months[1].inProgress).toBe(false)
  expect(m.actual).toHaveBeenCalledTimes(6)
  expect(m.actual.mock.calls[0][0]).toMatchObject({ where: { organizationId: 'org', assignedUserId: 'self', currency: 'USD', isClosed: true, deletedAt: null, stage: { isClosedWon: true, isClosedLost: false }, closeDate: { gte: new Date('2026-11-01T00:00:00Z'), lt: new Date('2026-12-01T00:00:00Z') } }, _sum: { dealValue: true } })
  expect(m.submissions.mock.calls[0][0]).toMatchObject({ where: { organizationId: 'org', userId: 'self', period: { in: report.months.map(row => row.period) } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  expect(m.snapshots.mock.calls[0][0].where.organizationId).toBe('org')
  expect(report.months.every(row => row.delta === null && row.attainment === null)).toBe(true)
})
it('selects the latest commit and compares only matching bases using exact decimal differences', async () => {
  m.submissions.mockResolvedValue([
    { id: 'latest', period: '2026-11', commitAmount: '100.10', ...basis },
    { id: 'older', period: '2026-11', commitAmount: '999.00', ...basis },
    { id: 'legacy', period: '2026-10', commitAmount: '50' },
    { id: 'other-currency', period: '2026-09', commitAmount: '50', ...basis, currency: 'PHP' },
    { id: 'zero', period: '2026-08', commitAmount: '0', ...basis },
  ])
  m.actual.mockResolvedValue({ _sum: { dealValue: '100.30' } })
  const { months } = await getForecastHistory('org', 'self', now)
  expect(months[0]).toMatchObject({ commitAmount: 100.10, basisStatus: 'verified', wonRevenue: 100.30, delta: 0.20, attainment: 100.2 })
  expect(months[1]).toMatchObject({ basisStatus: 'unverified', commitAmount: null, delta: null, attainment: null })
  expect(months[2]).toMatchObject({ basisStatus: 'incompatible', commitAmount: null, delta: null, attainment: null })
  expect(months[3]).toMatchObject({ commitAmount: 0, delta: 100.30, attainment: null })
})
it('keeps organization snapshots separate and hides unsupported or unverified money', async () => {
  const row = { id: 'snapshot', period: '2026-11', snapshotDate: now, totalPipeline: '100', weightedPipeline: '50', aiPredicted: '35' }
  m.snapshots.mockResolvedValue([{ ...row, ...basis, scope: 'ORGANIZATION' }, { ...row, id: 'legacy' }, { ...row, id: 'future', ...basis, scope: 'ORGANIZATION', calculationVersion: 'future' }])
  const { snapshots } = await getForecastHistory('org', 'self', now)
  expect(snapshots[0]).toMatchObject({ basisStatus: 'verified', totalPipeline: 100, weightedPipeline: 50, aiPredicted: 35 })
  expect(snapshots[1]).toMatchObject({ basisStatus: 'unverified', totalPipeline: null, weightedPipeline: null, aiPredicted: null })
  expect(snapshots[2]).toMatchObject({ basisStatus: 'incompatible', totalPipeline: null, weightedPipeline: null, aiPredicted: null })
  expect(m.snapshots.mock.calls[0][0]).toMatchObject({ take: 30, orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }] })
})
it('does not fall back to an older compatible commit when the latest uses a different basis', async () => {
  m.submissions.mockResolvedValue([{ id: 'new', period: '2026-11', commitAmount: '100', ...basis, scope: 'ORGANIZATION' }, { id: 'old', period: '2026-11', commitAmount: '100', ...basis }])
  const report = await getForecastHistory('org', 'self', now)
  expect(report.months[0]).toMatchObject({ basisStatus: 'incompatible', commitAmount: null, delta: null })
})
