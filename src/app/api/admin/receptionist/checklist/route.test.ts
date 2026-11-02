import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'

const mocks = vi.hoisted(() => ({ session: vi.fn(), checklist: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/services/receptionist-checklist', () => ({ getReceptionistChecklist: mocks.checklist }))
import { GET } from './route'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'admin' } })
})

describe('saved receptionist checklist route', () => {
  it('uses only the authenticated organization and disables caching', async () => {
    const data = { scope: 'saved_setup', checkedAt: '2026-11-02T00:00:00Z', settingsVersion: null, checks: [] }
    mocks.checklist.mockResolvedValue(data)
    const response = await GET()
    expect(response.status).toBe(200)
    expect(mocks.checklist).toHaveBeenCalledWith('session-org', 'admin')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ data })
  })

  it('rejects missing authentication before reading any setup', async () => {
    mocks.session.mockRejectedValue(new AppError('UNAUTHORIZED', 'Authentication required', 401))
    expect((await GET()).status).toBe(401)
    expect(mocks.checklist).not.toHaveBeenCalled()
  })

  it('preserves service access denial and hides unexpected errors', async () => {
    mocks.checklist.mockRejectedValueOnce(new AppError('FORBIDDEN', 'Administrator access required', 403))
    expect((await GET()).status).toBe(403)
    mocks.checklist.mockRejectedValueOnce(new Error('sensitive connection details'))
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: 'READINESS_UNAVAILABLE', message: 'Saved receptionist setup could not be checked.' } })
  })
})
