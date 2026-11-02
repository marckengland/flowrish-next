import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: async () => ({ organizationId: 'org', dbUser: { id: 'admin' } }) }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: vi.fn() }))
vi.mock('@/server/services/receptionist', () => ({ saveReceptionistConfig: mocks.save }))
vi.mock('@/server/db/client', () => ({ prisma: { receptionistConfig: { findUnique: async () => null }, organization: { findUnique: async () => ({ name: 'Sample business' }) }, organizationMember: { findMany: async () => [] }, stage: { findMany: async () => [] }, receptionistCall: { findMany: async () => [] } } }))
import { GET, PUT } from './route'
beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue({ enabled: false }) })
it('advertises create-only support without changing the settings body', async () => {
 const response = await GET()
 expect(response.headers.get('x-receptionist-conditional-create')).toBe('supported')
 expect((await response.json()).config).toBeNull()
})
it('honors a create-only precondition while preserving ordinary save calls', async () => {
 const body = { enabled: false }
 const conditional = new NextRequest('https://example.invalid/api/admin/receptionist', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' }, body: JSON.stringify(body) })
 expect((await PUT(conditional)).status).toBe(200)
 expect(mocks.save).toHaveBeenLastCalledWith('org', body, { createOnly: true })
 const ordinary = new NextRequest('https://example.invalid/api/admin/receptionist', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
 expect((await PUT(ordinary)).status).toBe(200)
 expect(mocks.save).toHaveBeenLastCalledWith('org', body)
})
