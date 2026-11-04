import { expect, it, vi } from 'vitest'
const db = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('No database access expected')
  }),
)
vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: db,
  TENANT_SCOPED_MODELS: [],
}))
vi.mock('@/server/db/client', () => ({ prisma: {} }))
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: vi.fn() }))
vi.mock('@/lib/env', () => ({
  env: new Proxy({}, { get: (_target, key) => `mock-${String(key)}` }),
}))
import { executeChatAction } from '../ai'
it('cannot execute a task proposal without the authorized server-session path', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('No provider call expected'))
  try {
    expect(
      await executeChatAction(
        {
          type: 'create_task',
          description: 'Practice',
          params: { title: 'Practice task' },
        },
        'user',
        'org',
      ),
    ).toMatchObject({ success: false })
    expect(db).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    fetch.mockRestore()
  }
})
