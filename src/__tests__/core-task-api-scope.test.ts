import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), tasks: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/services/tasks', () => ({
  getTasks: mocks.tasks,
  createTask: vi.fn(),
}))
import { GET } from '@/app/api/tasks/route'
const user = (hierarchy: number) => ({
  id: 'member',
  teamMemberships: [
    { role: { hierarchy, permissions: [{ key: 'leads:read' }] } },
  ],
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({
    organizationId: 'current',
    dbUser: user(3),
  })
  mocks.tasks.mockResolvedValue([])
})
it.each(['', '?assigneeId=colleague'])(
  'forces own-assignee scope for member requests %s',
  async (query) => {
    const response = await GET(
      new NextRequest(`https://flowrish.example/api/tasks${query}`),
    )
    expect(response.status).toBe(200)
    expect(mocks.tasks).toHaveBeenCalledWith(
      'member',
      expect.objectContaining({ assigneeId: 'member' }),
      'current',
    )
  },
)
it('retains manager-selected assignee and task filters', async () => {
  mocks.session.mockResolvedValue({
    organizationId: 'current',
    dbUser: user(2),
  })
  await GET(
    new NextRequest(
      'https://flowrish.example/api/tasks?assigneeId=colleague&priority=HIGH&isComplete=false',
    ),
  )
  expect(mocks.tasks).toHaveBeenCalledWith(
    'member',
    expect.objectContaining({
      assigneeId: 'colleague',
      priority: 'HIGH',
      isComplete: false,
    }),
    'current',
  )
})
it('denies task reads before business queries without leads read', async () => {
  mocks.session.mockResolvedValue({
    organizationId: 'current',
    dbUser: { id: 'member', teamMemberships: [] },
  })
  expect(
    (await GET(new NextRequest('https://flowrish.example/api/tasks'))).status,
  ).toBe(403)
  expect(mocks.tasks).not.toHaveBeenCalled()
})
