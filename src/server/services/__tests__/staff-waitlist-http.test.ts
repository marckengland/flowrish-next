import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  grant: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  options: vi.fn(),
  preview: vi.fn(),
  commit: vi.fn(),
}))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/waitlist-staff', () => ({
  assertWaitlistStaff: mocks.grant,
}))
vi.mock('@/server/services/staff-waitlist', () => ({
  listStaffWaitlist: mocks.list,
  updateStaffWaitlist: mocks.update,
  getWaitlistHandoffOptions: mocks.options,
  previewWaitlistHandoff: mocks.preview,
  commitWaitlistHandoff: mocks.commit,
}))
import { GET as list } from '@/app/api/staff/waitlist/route'
import { PATCH as update } from '@/app/api/staff/waitlist/[id]/route'
import {
  GET as options,
  POST as commit,
} from '@/app/api/staff/waitlist/[id]/handoff/route'
import { POST as preview } from '@/app/api/staff/waitlist/[id]/handoff/preview/route'
const id = '44444444-4444-4444-8444-444444444444'
const ctx = { params: Promise.resolve({ id }) }
const request = (method = 'GET', origin = 'https://flowrish.example') =>
  new Request(`https://flowrish.example/api/staff/waitlist/${id}/handoff`, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(method !== 'GET' ? { body: '{}' } : {}),
  })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({
    organizationId: 'org',
    dbUser: { id: 'staff' },
  })
  mocks.grant.mockResolvedValue(undefined)
  for (const fn of [
    mocks.list,
    mocks.update,
    mocks.options,
    mocks.preview,
    mocks.commit,
  ])
    fn.mockResolvedValue({ safe: true })
})
const handlers = [
  () => list(request()),
  () => update(request('PATCH'), ctx),
  () => options(request(), ctx),
  () => preview(request('POST'), ctx),
  () => commit(request('POST'), ctx),
]
it.each(handlers)(
  'denies unauthenticated requests before waitlist work',
  async (handler) => {
    mocks.session.mockRejectedValue(
      new AppError('UNAUTHORIZED', 'Authentication required', 401),
    )
    expect((await handler()).status).toBe(401)
    for (const fn of [
      mocks.list,
      mocks.update,
      mocks.options,
      mocks.preview,
      mocks.commit,
    ])
      expect(fn).not.toHaveBeenCalled()
  },
)
it.each(handlers)(
  'denies ungranted org admins before body or data work',
  async (handler) => {
    mocks.grant.mockRejectedValue(
      new AppError('FORBIDDEN', 'Staff access required', 403),
    )
    expect((await handler()).status).toBe(403)
    for (const fn of [
      mocks.list,
      mocks.update,
      mocks.options,
      mocks.preview,
      mocks.commit,
    ])
      expect(fn).not.toHaveBeenCalled()
  },
)
it.each([
  () => update(request('PATCH', 'https://foreign.example'), ctx),
  () => preview(request('POST', 'https://foreign.example'), ctx),
  () => commit(request('POST', 'https://foreign.example'), ctx),
])('rejects foreign-origin writes', async (handler) => {
  expect((await handler()).status).toBe(403)
  for (const fn of [mocks.update, mocks.preview, mocks.commit])
    expect(fn).not.toHaveBeenCalled()
})
it('returns private, noncached responses using only session organization/user identity', async () => {
  const response = await list(
    new Request(
      'https://flowrish.example/api/staff/waitlist?page=2&reviewStatus=new',
    ),
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie')
  expect(mocks.list).toHaveBeenCalledWith('org', 'staff', {
    page: '2',
    reviewStatus: 'new',
  })
})
