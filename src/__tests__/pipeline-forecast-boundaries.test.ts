import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AppError } from '@/lib/errors'
const m = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), move: vi.fn(), update: vi.fn(), forecast: vi.fn(), entitlement: vi.fn(), submission: vi.fn(), snapshots: vi.fn(), metrics: vi.fn(), audit: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/services/access', () => ({ getLeadAccessFilter: m.access }))
vi.mock('@/server/services/leads', () => ({ moveLead: m.move, updateLead: m.update, getLeadById: vi.fn(), softDeleteLead: vi.fn() }))
vi.mock('@/server/auth/entitlements', () => ({ requireEntitlement: m.entitlement }))
vi.mock('@/server/services/forecast', () => ({ submitForecast: m.forecast, calculatePipelineMetrics: m.metrics, assessForecastRisk: vi.fn(() => 'On Track') }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ forecastSubmission: { findFirst: m.submission }, forecastSnapshot: { findMany: m.snapshots }, auditEntry: { create: m.audit } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { PATCH as move } from '@/app/api/leads/[id]/move/route'
import { PATCH as update } from '@/app/api/leads/[id]/route'
import { GET as compare } from '@/app/api/forecast/compare/route'
import { submitForecast } from '@/server/actions/forecast'
import { revalidatePath } from 'next/cache'
const id = '11111111-1111-4111-8111-111111111111'
const stageId = '22222222-2222-4222-8222-222222222222'
beforeEach(() => {
  vi.resetAllMocks()
  m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user', teamMemberships: [{ role: { hierarchy: 3, permissions: [{ key: 'leads:write' }, { key: 'forecast:read' }, { key: 'forecast:submit' }] } }] } })
  m.access.mockResolvedValue({ deletedAt: null, assignedUserId: 'user' })
  m.move.mockResolvedValue({ id }); m.update.mockResolvedValue({ id }); m.forecast.mockResolvedValue({ id }); m.audit.mockResolvedValue({})
  m.metrics.mockResolvedValue({ totalPipeline: 100, weightedPipeline: 50, aiPredicted: 35 }); m.snapshots.mockResolvedValue([]); m.submission.mockResolvedValue(null)
})
it('passes a trusted record-access filter to both stage move and generic edit entry points', async () => {
  const context = { params: Promise.resolve({ id }) }
  expect((await move(new NextRequest(`https://example.test/api/leads/${id}/move`, { method: 'PATCH', body: JSON.stringify({ toStageId: stageId }) }), context)).status).toBe(200)
  expect(m.move).toHaveBeenCalledWith(id, stageId, 'user', 'org', { deletedAt: null, assignedUserId: 'user' })
  expect((await update(new NextRequest(`https://example.test/api/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ stageId }) }), context)).status).toBe(200)
  expect(m.update).toHaveBeenCalledWith(id, { stageId }, 'user', 'org', { deletedAt: null, assignedUserId: 'user' })
})
it('compares only the current user current-month commit and avoids classifying a missing commit', async () => {
  const response = await compare()
  const period = new Date().toISOString().slice(0, 7)
  expect(response.status).toBe(200)
  expect(m.submission.mock.calls[0][0].where).toEqual({ userId: 'user', period })
  expect((await response.json()).data.riskLevel).toBeNull()
})
it('checks the same forecasting entitlement for form actions as for the API before writing', async () => {
  m.entitlement.mockRejectedValue(new AppError('UPGRADE_REQUIRED', 'Forecast unavailable for this business', 403))
  const form = new FormData(); form.set('period', '2026-11'); form.set('commitAmount', '100')
  expect(await submitForecast(form)).toMatchObject({ error: 'Forecast unavailable for this business' })
  expect(m.forecast).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled()
})
it('rejects blank, nonfinite and overflowing form amounts before writing', async () => {
  for (const value of ['', ' ', 'Infinity', '10000000000']) {
    const form = new FormData(); form.set('period', '2026-11'); form.set('commitAmount', value)
    expect(await submitForecast(form)).toHaveProperty('error')
  }
  expect(m.forecast).not.toHaveBeenCalled()
})
it('preserves the known submission receipt when cache refresh fails after persistence', async () => {
  vi.mocked(revalidatePath).mockImplementationOnce(() => { throw new Error('Synthetic cache failure') })
  const form = new FormData(); form.set('period', '2026-11'); form.set('commitAmount', '100')
  expect(await submitForecast(form)).toEqual({ data: { id } })
  expect(m.forecast).toHaveBeenCalledTimes(1)
})
it('marks an unknown persistence failure as uncertain instead of enabling a blind retry', async () => {
  m.forecast.mockRejectedValue(new Error('Synthetic lost save acknowledgement'))
  const form = new FormData(); form.set('period', '2026-11'); form.set('commitAmount', '100')
  expect(await submitForecast(form)).toMatchObject({ uncertain: true })
  expect(m.forecast).toHaveBeenCalledTimes(1); expect(m.audit).not.toHaveBeenCalled()
})
