import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  create: vi.fn(),
  raw: vi.fn(),
}))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/services/task-access', () => ({
  createTaskFromProposal: mocks.create,
}))
vi.mock('@/server/services/ai', () => ({ executeChatAction: mocks.raw }))
import { POST } from '@/app/api/ai/chat/execute/route'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({
    organizationId: 'org',
    dbUser: {
      id: 'user',
      teamMemberships: [
        { role: { permissions: [{ key: 'leads:write' }], hierarchy: 3 } },
      ],
    },
  })
  mocks.create.mockResolvedValue({ id: 'task', leadId: 'lead' })
})
it('executes a task proposal only through trusted-session task access, without raw AI execution', async () => {
  const response = await POST(
    new NextRequest('https://flowrish.example/api/ai/chat/execute', {
      method: 'POST',
      body: JSON.stringify({
        action: {
          type: 'create_task',
          description: 'Practice reminder',
          params: { title: 'Practice task' },
        },
      }),
    }),
  )
  expect(response.status).toBe(200)
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      organizationId: 'org',
      dbUser: expect.objectContaining({ id: 'user' }),
    }),
    { title: 'Practice task' },
  )
  expect(mocks.raw).not.toHaveBeenCalled()
  expect(await response.json()).toMatchObject({
    data: { success: true, data: { taskId: 'task', leadId: 'lead' } },
  })
})
