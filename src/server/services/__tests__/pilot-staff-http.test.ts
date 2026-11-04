import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), staff: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/waitlist-staff', () => ({
  assertWaitlistStaff: mocks.staff,
}))
import { pilotStaffResponse } from '../pilot-staff-http'
import { pilotCookieOptions } from '../pilot-http'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({
    dbUser: { id: 'staff' },
    organizationId: 'staff-org',
  })
  mocks.staff.mockResolvedValue({})
})
it('denies revoked staff before parsing or running the request work', async () => {
  mocks.staff.mockRejectedValue(
    new AppError('FORBIDDEN', 'Flowrish staff access is required.', 403),
  )
  const work = vi.fn()
  const response = await pilotStaffResponse(work)
  expect(response.status).toBe(403)
  expect(work).not.toHaveBeenCalled()
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})
it('runs authorized work with only server session identity', async () => {
  const work = vi.fn().mockResolvedValue({ safe: true })
  const response = await pilotStaffResponse(work)
  expect(response.status).toBe(200)
  expect(mocks.staff).toHaveBeenCalledWith('staff-org', 'staff')
  expect(work).toHaveBeenCalledWith({
    dbUser: { id: 'staff' },
    organizationId: 'staff-org',
  })
})
it('uses a secure host-only production cookie', () => {
  vi.stubEnv('NODE_ENV', 'production')
  try {
    expect(pilotCookieOptions(3600)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600,
    })
  } finally {
    vi.unstubAllEnvs()
  }
})
