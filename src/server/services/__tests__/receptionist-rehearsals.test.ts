import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ member: vi.fn(), permissions: vi.fn(), list: vi.fn(), get: vi.fn(), save: vi.fn(), update: vi.fn(), remove: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { organizationMember: { findUnique: mocks.member }, receptionistRehearsal: { findMany: mocks.list, findFirst: mocks.get, createMany: mocks.save, updateMany: mocks.update, deleteMany: mocks.remove } } }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: mocks.permissions }))
import { createRehearsal, deleteRehearsal, getRehearsal, listRehearsals, reviewRehearsal } from '../receptionist-rehearsals'

const id = '11111111-1111-4111-8111-111111111111'
const clientId = '22222222-2222-4222-8222-222222222222'
const time = new Date('2026-11-02T00:00:00Z')
const snapshot = { clientId, settingsVersion: time.toISOString(), finished: false, messages: [{ role: 'receptionist', content: 'Hello', sources: [], generation: 'scripted' }, { role: 'caller', content: 'What is the price?', sources: [], generation: 'scripted' }] }
const row = { id, organizationId: 'org', clientId, createdById: 'user', title: 'Pricing rehearsal', snapshot, verdict: 'unreviewed', notes: '', unansweredMessageIndexes: [], createdAt: time, updatedAt: time }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.member.mockResolvedValue({ id: 'member' })
  mocks.permissions.mockResolvedValue(new Set(['admin:settings']))
  mocks.list.mockResolvedValue([row])
  mocks.get.mockResolvedValue(row)
  mocks.save.mockResolvedValue(row)
  mocks.update.mockResolvedValue({ count: 1 })
  mocks.remove.mockResolvedValue({ count: 1 })
})

describe('organization rehearsal reports', () => {
  it('requires current membership and settings permission before reads or writes', async () => {
    mocks.member.mockResolvedValue(null)
    await expect(listRehearsals('org', 'user')).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.list).not.toHaveBeenCalled()
    mocks.member.mockResolvedValue({ id: 'member' })
    mocks.permissions.mockResolvedValue(new Set())
    await expect(createRehearsal('org', 'user', { title: 'Pricing', snapshot })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('lists only organization metadata with a bounded chronological query', async () => {
    const data = await listRehearsals('org', 'user')
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org' }, take: 25, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: expect.any(Object) }))
    expect(mocks.list.mock.calls[0][0].select).not.toHaveProperty('snapshot')
    expect(data[0]).not.toHaveProperty('snapshot')
    expect(data[0]).not.toHaveProperty('organizationId')
  })
  it('saves an immutable validated browser snapshot idempotently without AI or CRM operations', async () => {
    const result = await createRehearsal('org', 'user', { title: 'Pricing rehearsal', snapshot })
    expect(result.snapshot).toEqual(snapshot)
    expect(mocks.save).toHaveBeenCalledWith({ data: [{ organizationId: 'org', clientId, createdById: 'user', title: 'Pricing rehearsal', snapshot }], skipDuplicates: true })
    expect(mocks.get).toHaveBeenCalledWith({ where: { organizationId: 'org', clientId } })
  })
  it('rejects extra organization/settings fields and malformed or oversized snapshots', async () => {
    for (const input of [{ title: 'Pricing', snapshot, organizationId: 'other' }, { title: '', snapshot }, { title: 'Pricing', snapshot: { ...snapshot, apiKey: 'synthetic-invalid-field' } }]) await expect(createRehearsal('org', 'user', input)).rejects.toBeDefined()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('returns 404 for missing and cross-organization report identifiers', async () => {
    mocks.get.mockResolvedValue(null)
    await expect(getRehearsal('other-org', 'user', id)).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.get).toHaveBeenCalledWith({ where: { id, organizationId: 'other-org' } })
  })
  it('updates only manual review with tenant/version scope and only caller knowledge gaps', async () => {
    await reviewRehearsal('org', 'user', id, { expectedUpdatedAt: time.toISOString(), verdict: 'needs_work', notes: 'Missing price', unansweredMessageIndexes: [1] })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id, organizationId: 'org', updatedAt: time }, data: expect.objectContaining({ verdict: 'needs_work', notes: 'Missing price', unansweredMessageIndexes: [1] }) }))
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty('snapshot')
    await expect(reviewRehearsal('org', 'user', id, { expectedUpdatedAt: time.toISOString(), verdict: 'passed', notes: '', unansweredMessageIndexes: [0] })).rejects.toBeDefined()
    expect(mocks.update).toHaveBeenCalledTimes(1)
  })
  it('rejects stale reviews instead of overwriting another reviewer', async () => {
    mocks.update.mockResolvedValue({ count: 0 })
    await expect(reviewRehearsal('org', 'user', id, { expectedUpdatedAt: time.toISOString(), verdict: 'passed', notes: '', unansweredMessageIndexes: [] })).rejects.toMatchObject({ statusCode: 409 })
  })
  it('deletes only one organization report and returns 404 for inaccessible records', async () => {
    expect(await deleteRehearsal('org', 'user', id)).toEqual({ deleted: true })
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id, organizationId: 'org' } })
    mocks.remove.mockResolvedValue({ count: 0 })
    await expect(deleteRehearsal('other', 'user', id)).rejects.toMatchObject({ statusCode: 404 })
  })
  it('sanitizes unexpected database failures without leaking query details', async () => {
    mocks.list.mockRejectedValue(new Error('private SQL connection and credentials'))
    await expect(listRehearsals('org', 'user')).rejects.toMatchObject({ code: 'REHEARSAL_UNAVAILABLE', statusCode: 503, message: 'Rehearsal reports are unavailable. Please try again.' })
  })
})
