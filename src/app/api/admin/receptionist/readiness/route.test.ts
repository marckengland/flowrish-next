import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'

const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), readiness: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/services/receptionist-preview', () => ({ getReceptionistReadiness: mocks.readiness }))
import { GET } from './route'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'admin' } })
})

describe('receptionist readiness route', () => {
  it('rejects unauthorized users before reading settings', async () => {
    mocks.session.mockRejectedValue(new AppError('UNAUTHORIZED', 'Authentication required', 401))
    expect((await GET()).status).toBe(401)
    mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'admin' } })
    mocks.permission.mockImplementation(() => { throw new AppError('FORBIDDEN', 'Forbidden', 403) })
    expect((await GET()).status).toBe(403)
    expect(mocks.readiness).not.toHaveBeenCalled()
  })

  it('returns only the session org readiness and disables caching', async () => {
    const data = { saved: false, settingsVersion: null, approvedDocuments: 0, hasManualKnowledge: false, voiceConfigured: false, hasAuthToken: false }
    mocks.readiness.mockResolvedValue(data)
    const response = await GET()
    expect(response.status).toBe(200)
    expect(mocks.permission).toHaveBeenCalledWith({ id: 'admin' }, 'admin:settings')
    expect(mocks.readiness).toHaveBeenCalledWith('session-org', 'admin')
    expect(await response.json()).toEqual({ data })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
