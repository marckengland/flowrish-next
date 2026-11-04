import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  staff: vi.fn(),
  read: vi.fn(),
}))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/waitlist-staff', () => ({
  assertWaitlistStaff: mocks.staff,
}))
vi.mock('@/server/services/pilot-progress', () => ({
  getPilotProgress: mocks.read,
}))
import { GET } from './route'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({
    dbUser: { id: 'staff' },
    organizationId: 'staff-org',
  })
  mocks.read.mockResolvedValue({
    state: 'unavailable',
    checkedAt: '2026-11-04T02:00:00.000Z',
  })
})
it('checks staff before resolving requested signup and returns only private no-store progress', async () => {
  const response = await GET(
    new Request(
      'https://flowrish.example/api/staff/waitlist/id/pilot/progress',
    ),
    { params: Promise.resolve({ id: 'source' }) },
  )
  expect(mocks.staff).toHaveBeenCalledWith('staff-org', 'staff')
  expect(mocks.read).toHaveBeenCalledWith('staff-org', 'staff', 'source')
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  expect(await response.json()).toEqual({
    data: { state: 'unavailable', checkedAt: '2026-11-04T02:00:00.000Z' },
  })
})
it('rejects revoked staff without any customer lookup', async () => {
  mocks.staff.mockRejectedValue(
    new AppError('FORBIDDEN', 'Flowrish staff access is required.', 403),
  )
  expect(
    (
      await GET(
        new Request(
          'https://flowrish.example/api/staff/waitlist/id/pilot/progress',
        ),
        { params: Promise.resolve({ id: 'source' }) },
      )
    ).status,
  ).toBe(403)
  expect(mocks.read).not.toHaveBeenCalled()
})
it('hides unexpected database errors and never logs customer values', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    mocks.read.mockRejectedValue(new Error('private database content'))
    const response = await GET(
      new Request(
        'https://flowrish.example/api/staff/waitlist/id/pilot/progress',
      ),
      { params: Promise.resolve({ id: 'source' }) },
    )
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain(
      'private database content',
    )
    expect(log).not.toHaveBeenCalled()
  } finally {
    log.mockRestore()
  }
})
