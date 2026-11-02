import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), transaction: vi.fn(), lock: vi.fn(), link: vi.fn(), addLink: vi.fn(), count: vi.fn(), create: vi.fn(), document: vi.fn(), audit: vi.fn() }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: mocks.permission }))
vi.mock('@/server/db/client', () => ({ prisma: { organizationMember: { findUnique: mocks.member }, $transaction: mocks.transaction, knowledgeDocument: { findFirst: mocks.document }, rehearsalFaqDraft: { findFirst: mocks.link } } }))
import { createRehearsalFaq, getRehearsalFaqOrigin } from '../rehearsal-faq'
const id = '11111111-1111-4111-8111-111111111111', documentId = '22222222-2222-4222-8222-222222222222'
const time = new Date('2026-11-02T00:00:00Z')
const snapshot = { clientId: id, settingsVersion: time.toISOString(), finished: false, messages: [{ role: 'receptionist', content: 'Secret neighboring reply must not be copied.', sources: [], generation: 'scripted' }, { role: 'caller', content: 'What are your Sunday opening hours?', sources: [], generation: 'scripted' }] }
const rehearsal = { id, updatedAt: time, snapshot, unansweredMessageIndexes: [1] }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.member.mockResolvedValue({ id: 'member' })
  mocks.permission.mockResolvedValue(new Set(['admin:settings']))
  mocks.lock.mockImplementation(async (_strings, ...values) => values.length === 1 ? [{ id: 'org' }] : [rehearsal])
  mocks.link.mockResolvedValue(null)
  mocks.count.mockResolvedValue(0)
  mocks.create.mockResolvedValue({ id: documentId, revision: 1 })
  mocks.addLink.mockResolvedValue({ id: 'link' })
  mocks.audit.mockResolvedValue({ id: 'audit' })
  mocks.document.mockResolvedValue({ id: documentId })
  mocks.transaction.mockImplementation(async callback => callback({ $queryRaw: mocks.lock, rehearsalFaqDraft: { findFirst: mocks.link, create: mocks.addLink }, knowledgeDocument: { count: mocks.count, create: mocks.create }, auditEntry: { create: mocks.audit } }))
})
const input = { messageIndex: 1, expectedUpdatedAt: time.toISOString() }
describe('rehearsal to private FAQ draft', () => {
  it('creates only the saved question with a blank answer and separate origin inside one transaction', async () => {
    expect(await createRehearsalFaq('org', 'user', id, input)).toEqual({ documentId, knowledgeUrl: `/knowledge?document=${documentId}`, created: true })
    expect(mocks.create).toHaveBeenCalledWith({ data: { organizationId: 'org', createdById: 'user', title: 'FAQ: What are your Sunday opening hours?', category: 'FAQ', contentText: 'Question: What are your Sunday opening hours?\n\nAnswer:\n' } })
    expect(mocks.addLink).toHaveBeenCalledWith({ data: { organizationId: 'org', rehearsalId: id, messageIndex: 1, documentId } })
    expect(mocks.audit).toHaveBeenCalledWith({ data: { organizationId: 'org', userId: 'user', action: 'CREATE', entityType: 'KnowledgeDocument', entityId: documentId, changes: { revision: 1 } } })
    expect(mocks.lock.mock.calls[0].slice(1)).toEqual(['org'])
    expect(mocks.lock.mock.calls[1].slice(1)).toEqual([id, 'org'])
  })
  it('returns an existing linked document without changing it even when the library is full', async () => {
    mocks.link.mockResolvedValue({ documentId })
    mocks.count.mockResolvedValue(50)
    expect((await createRehearsalFaq('org', 'user', id, input)).created).toBe(false)
    expect(mocks.count).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('compares review versions as timestamps rather than datetime formatting', async () => {
    expect((await createRehearsalFaq('org', 'user', id, { ...input, expectedUpdatedAt: '2026-11-02T00:00:00Z' })).created).toBe(true)
  })
  it('requires current membership and admin permission before any document action', async () => {
    mocks.member.mockResolvedValue(null)
    await expect(createRehearsalFaq('org', 'user', id, input)).rejects.toMatchObject({ statusCode: 403 })
    mocks.member.mockResolvedValue({ id: 'member' }); mocks.permission.mockResolvedValue(new Set())
    await expect(getRehearsalFaqOrigin('org', 'user', documentId)).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.document).not.toHaveBeenCalled()
  })
  it('rejects stale reviews, unflagged/non-caller messages, and client-supplied content', async () => {
    await expect(createRehearsalFaq('org', 'user', id, { ...input, expectedUpdatedAt: '2026-11-01T00:00:00Z' })).rejects.toMatchObject({ statusCode: 409 })
    await expect(createRehearsalFaq('org', 'user', id, { ...input, messageIndex: 0 })).rejects.toMatchObject({ statusCode: 400 })
    mocks.lock.mockImplementation(async (_strings, ...values) => values.length === 1 ? [{ id: 'org' }] : [{ ...rehearsal, unansweredMessageIndexes: [] }])
    await expect(createRehearsalFaq('org', 'user', id, input)).rejects.toMatchObject({ statusCode: 400 })
    await expect(createRehearsalFaq('org', 'user', id, { ...input, contentText: 'Invented answer' })).rejects.toBeDefined()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('rejects new drafts at the existing active-document cap and missing/cross-org reports', async () => {
    mocks.count.mockResolvedValue(50)
    await expect(createRehearsalFaq('org', 'user', id, input)).rejects.toMatchObject({ code: 'KNOWLEDGE_LIMIT', statusCode: 400 })
    mocks.lock.mockImplementation(async (_strings, ...values) => values.length === 1 ? [{ id: 'org' }] : [])
    await expect(createRehearsalFaq('other', 'user', id, input)).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('returns same-organization source metadata only and handles a removed origin', async () => {
    mocks.link.mockResolvedValue({ messageIndex: 1, rehearsal: { id, title: 'Opening hours rehearsal' } })
    expect(await getRehearsalFaqOrigin('org', 'user', documentId)).toEqual({ rehearsalId: id, title: 'Opening hours rehearsal', messageIndex: 1, rehearsalUrl: `/settings?section=receptionist&rehearsal=${id}` })
    expect(mocks.document).toHaveBeenCalledWith({ where: { id: documentId, organizationId: 'org' }, select: { id: true } })
    expect(mocks.link).toHaveBeenCalledWith({ where: { organizationId: 'org', documentId }, select: { messageIndex: true, rehearsal: { select: { id: true, title: true } } } })
    mocks.link.mockResolvedValue(null)
    expect(await getRehearsalFaqOrigin('org', 'user', documentId)).toBeNull()
    mocks.document.mockResolvedValue(null)
    await expect(getRehearsalFaqOrigin('other', 'user', documentId)).rejects.toMatchObject({ statusCode: 404 })
  })
  it('hides unexpected database errors', async () => {
    mocks.transaction.mockRejectedValue(new Error('private database credentials'))
    await expect(createRehearsalFaq('org', 'user', id, input)).rejects.toMatchObject({ code: 'FAQ_DRAFT_UNAVAILABLE', statusCode: 503, message: 'Rehearsal FAQ drafts are unavailable. Please try again.' })
  })
})
