import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AppError } from '@/lib/errors'

const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), save: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/db/client', () => ({ prisma: {} }))
vi.mock('@/server/services/receptionist', () => ({ saveReceptionistConfig: mocks.save }))
import { GET, PUT } from './route'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'session-user' } })
})

describe('receptionist administration', () => {
  it('rejects unauthorized reads and writes before accessing settings', async () => {
    mocks.permission.mockImplementation(() => { throw new AppError('FORBIDDEN', 'Insufficient permissions', 403) })
    expect((await GET()).status).toBe(403)
    expect((await PUT(new NextRequest('https://crm.test/api/admin/receptionist', { method: 'PUT', body: '{}' }))).status).toBe(403)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('saves only to the organization from the authenticated session', async () => {
    mocks.save.mockResolvedValue({ enabled: false })
    const response = await PUT(new NextRequest('https://crm.test/api/admin/receptionist', { method: 'PUT', body: JSON.stringify({ organizationId: 'other-org', enabled: false }) }))
    expect(response.status).toBe(200)
    expect(mocks.permission).toHaveBeenCalledWith({ id: 'session-user' }, 'admin:settings')
    expect(mocks.save).toHaveBeenCalledWith('session-org', { organizationId: 'other-org', enabled: false })
  })
})
