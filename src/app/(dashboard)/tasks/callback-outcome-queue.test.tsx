import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ canWrite: true, session: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ hasPermission: (_user: unknown, key: string) => key === 'leads:read' || key === 'leads:write' && mocks.canWrite }))
vi.mock('@/server/db/client', () => ({ prisma: { organizationMember: { findMany: async () => [] } } }))
vi.mock('@/server/services/access', () => ({ getLeadAccessFilter: async () => ({}) }))
vi.mock('@/server/services/leads', () => ({ getLeads: async () => ({ leads: [] }) }))
vi.mock('@/server/services/tasks', () => ({ getTasks: async () => [] }))
vi.mock('@/components/tasks/task-list', () => ({ TaskList: () => <p>Task list</p> }))
vi.mock('@/components/tasks/task-form', () => ({ TaskForm: () => null }))
import TasksPage from './page'
beforeEach(() => { mocks.canWrite = true; mocks.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'staff', name: 'Staff', email: 'staff@example.invalid', teamMemberships: [{ role: { hierarchy: 3 } }] } }); vi.stubGlobal('fetch', vi.fn()) })
describe('assigned staff callback queue entry point', () => {
  it('makes the queue available on Tasks without admin settings permission and with no mount requests', async () => {
    render(await TasksPage()); expect(screen.getByRole('region', { name: 'Callback work queue' })).toBeVisible(); expect(screen.getByRole('button', { name: 'Load callback work queue' })).toBeEnabled(); expect(fetch).not.toHaveBeenCalled()
  })
  it('does not offer outcome management to read-only staff', async () => {
    mocks.canWrite = false; render(await TasksPage()); expect(screen.queryByRole('region', { name: 'Callback work queue' })).toBeNull()
  })
})
