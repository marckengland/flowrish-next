import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ member: vi.fn(), permissions: vi.fn(), rows: vi.fn() }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: m.permissions }))
vi.mock('@/server/db/client', () => ({ prisma: { organizationMember: { findUnique: m.member }, savedFollowUpView: { findMany: m.rows } } }))
import { listSavedFollowUpViews } from '../saved-follow-up-views'
const row = { id: '11111111-1111-4111-8111-111111111111', name: 'All reviewed', settings: { status: 'APPROVED', filters: { search: '', source: 'ALL', dueOnly: false } }, revision: 1, updatedAt: new Date('2026-11-06') }
beforeEach(() => { vi.resetAllMocks(); m.member.mockResolvedValue({ id: 'member' }); m.permissions.mockResolvedValue(new Set(['leads:read'])); m.rows.mockResolvedValue([row, { ...row, id: '22222222-2222-4222-8222-222222222222', name: 'Overdue', settings: { ...row.settings, filters: { ...row.settings.filters, taskProgress: 'OVERDUE' } } }]) })
it('hides sorted views before strict decoding for every non-order client and preserves records', async () => {
 const sorted = {...row,name:'Earliest',settings:{...row.settings,filters:{...row.settings.filters,taskOrder:'DUE_ASC'}}}; m.rows.mockResolvedValue([row,sorted]); const before=JSON.stringify(sorted)
 for(const progress of [true,false])expect((await listSavedFollowUpViews('org','actor',progress)).map(view=>view.name)).toEqual(['All reviewed'])
 expect((await listSavedFollowUpViews('org','actor',true,true))[1].settings.filters.taskOrder).toBe('DUE_ASC'); expect(JSON.stringify(sorted)).toBe(before)
})
