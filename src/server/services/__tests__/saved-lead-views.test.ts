import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ member: vi.fn(), permissions: vi.fn(), lock: vi.fn(), list: vi.fn(), get: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), stage: vi.fn(), pipeline: vi.fn() }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: m.permissions }))
vi.mock('@/server/db/client', () => {
  const db = { organizationMember: { findUnique: m.member }, savedLeadView: { findMany: m.list, findFirst: m.get, count: m.count, create: m.create, updateMany: m.update, deleteMany: m.remove }, stage: { findFirst: m.stage }, pipeline: { findFirst: m.pipeline }, $queryRaw: m.lock }
  return { prisma: { ...db, $transaction: (run: (db: unknown) => unknown) => run(db) } }
})
import { createSavedLeadView, deleteSavedLeadView, listSavedLeadViews, updateSavedLeadView } from '../saved-lead-views'
const id = '11111111-1111-4111-8111-111111111111', filterId = '22222222-2222-4222-8222-222222222222'
const row = { id, organizationId: 'org', userId: 'user', name: 'Prospects', filters: { leadStatus: 'NEW' }, revision: 1, updatedAt: new Date('2026-11-05T00:00:00Z') }
beforeEach(() => {
  vi.resetAllMocks(); m.member.mockResolvedValue({ id: 'member' }); m.permissions.mockResolvedValue(new Set(['leads:read'])); m.lock.mockResolvedValue([{ id: 'member' }]); m.list.mockResolvedValue([row]); m.get.mockResolvedValue(row); m.count.mockResolvedValue(0); m.create.mockResolvedValue(row); m.update.mockResolvedValue({ count: 1 }); m.remove.mockResolvedValue({ count: 1 }); m.stage.mockResolvedValue({ id: filterId }); m.pipeline.mockResolvedValue({ id: filterId })
})
describe('personal lead views', () => {
  it('requires retained membership and current lead-read permission before accessing preferences', async () => {
    m.member.mockResolvedValue(null); await expect(listSavedLeadViews('org', 'user')).rejects.toMatchObject({ statusCode: 403 }); expect(m.list).not.toHaveBeenCalled()
    m.member.mockResolvedValue({ id: 'member' }); m.permissions.mockResolvedValue(new Set()); await expect(listSavedLeadViews('org', 'user')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('lists only the current workspace/user with a bounded query and serializes private preferences', async () => {
    const data = await listSavedLeadViews('org', 'user'); expect(m.list).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org', userId: 'user' }, take: 20 })); expect(data[0]).toMatchObject({ id, revision: 1, updatedAt: row.updatedAt.toISOString() }); expect(data[0]).not.toHaveProperty('organizationId'); expect(data[0]).not.toHaveProperty('userId')
  })
  it('creates under a membership lock, enforces the limit, and validates scoped references', async () => {
    m.get.mockResolvedValue(null)
    await createSavedLeadView('org', 'user', { id, name: row.name, filters: { stageId: filterId, assignedUserId: filterId } })
    expect(m.lock).toHaveBeenCalled(); expect(m.stage).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: filterId, pipeline: { organizationId: 'org' } }) })); expect(m.member).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_organizationId: { userId: filterId, organizationId: 'org' } } })); expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id, organizationId: 'org', userId: 'user' }) }))
    m.count.mockResolvedValue(20); await expect(createSavedLeadView('org', 'user', { id, name: 'Another', filters: {} })).rejects.toMatchObject({ statusCode: 409 }); expect(m.create).toHaveBeenCalledTimes(1)
  })
  it('replays identical uncertain creates without another insert and rejects changed payloads', async () => {
    await expect(createSavedLeadView('org', 'user', { id, name: row.name, filters: row.filters })).resolves.toMatchObject({ id }); expect(m.create).not.toHaveBeenCalled()
    await expect(createSavedLeadView('org', 'user', { id, name: 'Changed', filters: {} })).rejects.toMatchObject({ statusCode: 409 })
  })
  it('rejects unavailable or foreign references and a removed membership without creating records', async () => {
    m.get.mockResolvedValue(null); m.stage.mockResolvedValue(null); await expect(createSavedLeadView('org', 'user', { id, name: 'Bad stage', filters: { stageId: filterId } })).rejects.toMatchObject({ statusCode: 400 }); expect(m.create).not.toHaveBeenCalled()
    m.lock.mockResolvedValue([]); await expect(createSavedLeadView('org', 'user', { id, name: 'Removed', filters: {} })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('scopes updates/deletes by owner, workspace and expected revision; stale changes cannot overwrite', async () => {
    await updateSavedLeadView('org', 'user', id, { expectedRevision: 1, name: 'Renamed' }); expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id, organizationId: 'org', userId: 'user', revision: 1 }, data: expect.objectContaining({ name: 'Renamed', revision: { increment: 1 } }) }))
    await deleteSavedLeadView('org', 'user', id, { expectedRevision: 1 }); expect(m.remove).toHaveBeenCalledWith({ where: { id, organizationId: 'org', userId: 'user', revision: 1 } })
    m.update.mockResolvedValue({ count: 0 }); await expect(updateSavedLeadView('org', 'user', id, { expectedRevision: 1, name: 'Stale' })).rejects.toMatchObject({ statusCode: 409 })
    m.remove.mockResolvedValue({ count: 0 }); await expect(deleteSavedLeadView('org', 'user', id, { expectedRevision: 1 })).rejects.toMatchObject({ statusCode: 409 })
  })
  it('returns not-found for another workspace/user identifier and redacts database errors', async () => {
    m.get.mockResolvedValue(null); await expect(updateSavedLeadView('other', 'other-user', id, { expectedRevision: 1, name: 'Bad' })).rejects.toMatchObject({ statusCode: 404 }); expect(m.get).toHaveBeenCalledWith({ where: { id, organizationId: 'other', userId: 'other-user' } })
    m.list.mockRejectedValue(new Error('private SQL password')); await expect(listSavedLeadViews('org', 'user')).rejects.toMatchObject({ code: 'SAVED_VIEWS_UNAVAILABLE', statusCode: 503, message: 'Saved views are unavailable. Please refresh and try again.' })
    m.get.mockResolvedValue(null); m.create.mockRejectedValue({ code: 'P2002' }); await expect(createSavedLeadView('org', 'user', { id, name: 'Duplicate', filters: {} })).rejects.toMatchObject({ statusCode: 409 })
  })
})
