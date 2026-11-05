import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: { findUnique: vi.fn() }, suggestion: { findFirst: vi.fn(), updateMany: vi.fn() }, lead: { findFirst: vi.fn() }, account: { findFirst: vi.fn() }, message: { findFirst: vi.fn() }, access: vi.fn(), permission: vi.fn(), entitlement: vi.fn(), fetchConversation: vi.fn(), generate: vi.fn() }))
vi.mock('@/server/db/client', () => { const db = { user: mocks.user, followUpSuggestion: mocks.suggestion, lead: mocks.lead, emailAccount: mocks.account, emailMessage: mocks.message, $queryRaw: vi.fn(async () => [{ id: 'member' }]) }; return { prisma: { ...db, $transaction: async (fn: (tx: typeof db) => unknown) => fn(db) } } })
vi.mock('@/server/services/access', () => ({ getLeadAccessFilter: mocks.access }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission, hasPermission: () => true }))
vi.mock('@/server/auth/entitlements', () => ({ requireEntitlement: mocks.entitlement }))
vi.mock('@/server/services/email-conversation', () => ({ fetchEmailConversation: mocks.fetchConversation }))
vi.mock('@/server/services/ai', () => ({ generateConversationFollowUp: mocks.generate }))
import { generateFollowUpDraft, prepareFollowUpSend } from '../follow-up-drafts'
const context = { mailboxEmail: 'owner@example.invalid', accountId: 'account', provider: 'gmail', threadId: 'thread', recipientEmail: 'alternate@example.invalid', fingerprint: 'fingerprint', messageCount: 2, lastMessageAt: '2026-11-02T03:00:00Z' }
const suggestion = { id: 'suggestion', organizationId: 'org', assigneeId: 'user', leadId: 'lead', sourceType: 'EMAIL', sourceId: 'source', sourceThreadId: 'thread', sourceKey: JSON.stringify(['gmail','account','source']), status: 'PENDING', updatedAt: new Date('2026-11-02'), draftGeneratedAt: new Date('2026-11-02'), draftVersion: 'version', draftContext: context }
const conversation = { ...context, mailboxEmail: 'owner@example.invalid', subject: 'Proposal', messages: [{ id: 'source', fromEmail: 'alternate@example.invalid', toEmails: ['owner@example.invalid'], sentAt: '2026-11-02T02:00:00Z', text: 'Can we discuss scope?', subject: 'Proposal', messageId: '<source@example.invalid>' }, { id: 'latest', fromEmail: 'owner@example.invalid', toEmails: ['alternate@example.invalid'], sentAt: context.lastMessageAt, text: 'Yes, what works?', subject: 'Proposal', messageId: '<latest@example.invalid>', references: '<source@example.invalid>' }] }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.user.findUnique.mockResolvedValue({ id: 'user', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [] })
  mocks.access.mockResolvedValue({ deletedAt: null, assignedUserId: 'user' })
  mocks.suggestion.findFirst.mockResolvedValue(suggestion)
  mocks.suggestion.updateMany.mockResolvedValue({ count: 1 })
  mocks.lead.findFirst.mockResolvedValue({ id: 'lead', email: 'primary@example.invalid', altEmail: 'alternate@example.invalid' })
  mocks.account.findFirst.mockResolvedValue({ id: 'account', provider: 'gmail', userId: 'user', email: 'owner@example.invalid' })
  mocks.message.findFirst.mockResolvedValue({ id: 'saved', fromEmail: 'alternate@example.invalid', activity: { leadId: 'lead', organizationId: 'org' } })
  mocks.fetchConversation.mockResolvedValue(conversation)
  mocks.generate.mockResolvedValue({ subject: 'Re: Proposal', body: 'Hello,\nLet us discuss the scope.' })
})
describe('conversation follow-up drafts', () => {
  it('generates from the full source conversation and persists only draft metadata', async () => {
    const result = await generateFollowUpDraft('org','user','suggestion','Ask for a time')
    expect(result.subject).toBe('Re: Proposal')
    expect(result.context.recipientEmail).toBe('alternate@example.invalid')
    expect(mocks.fetchConversation).toHaveBeenCalledWith({ accountId: 'account', organizationId: 'org', userId: 'user', threadId: 'thread', sourceMessageId: 'source', leadEmails: ['primary@example.invalid', 'alternate@example.invalid'] })
    expect(mocks.generate).toHaveBeenCalledWith(conversation, 'Ask for a time', 'org')
    const update = mocks.suggestion.updateMany.mock.calls[0][0]
    expect(update.where).toMatchObject({ id: 'suggestion', organizationId: 'org', assigneeId: 'user', updatedAt: suggestion.updatedAt, status: { not: 'DISMISSED' } })
    expect(update.data.draftContext).toEqual(context)
    expect(JSON.stringify(update.data)).not.toContain('Can we discuss scope?')
    expect(result.context).not.toHaveProperty('fingerprint')
  })
  it('keeps the verified thread subject even when AI proposes a different subject', async () => {
    mocks.generate.mockResolvedValue({ subject: 'Invented new sales subject', body: 'Reviewed conversation reply.' })
    const result = await generateFollowUpDraft('org','user','suggestion')
    expect(result.subject).toBe('Re: Proposal')
    expect(mocks.suggestion.updateMany.mock.calls[0][0].data.draftSubject).toBe('Re: Proposal')
  })
  it('preserves the previous draft if dismissed or regenerated while AI was running', async () => {
    mocks.suggestion.updateMany.mockResolvedValue({ count: 0 })
    await expect(generateFollowUpDraft('org','user','suggestion')).rejects.toMatchObject({ statusCode: 409 })
  })
  it('does not retrieve mail or call AI without valid current lead access', async () => {
    mocks.lead.findFirst.mockResolvedValue(null)
    await expect(generateFollowUpDraft('org','user','suggestion')).rejects.toThrow('Lead')
    expect(mocks.fetchConversation).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('rejects dismissed, call-source, and tampered mailbox identities', async () => {
    for (const change of [{ status: 'DISMISSED' }, { sourceType: 'CALL' }, { sourceKey: JSON.stringify(['gmail','other-account','other-message']) }]) {
      mocks.suggestion.findFirst.mockResolvedValue({ ...suggestion, ...change })
      await expect(generateFollowUpDraft('org','user','suggestion')).rejects.toThrow()
    }
    expect(mocks.fetchConversation).not.toHaveBeenCalled()
  })
  it('binds send preparation to the exact source mailbox, alternate recipient, thread, and RFC reply header', async () => {
    const result = await prepareFollowUpSend('org','user','suggestion','version','lead')
    expect(result).toEqual({ threadId: 'thread', subject: 'Re: Proposal', options: { accountId: 'account', recipientEmail: 'alternate@example.invalid', reviewedFollowUp: { id: 'suggestion', version: 'version' }, replyMessageId: '<latest@example.invalid>', replyReferences: '<source@example.invalid> <latest@example.invalid>' } })
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('rejects stale versions, changed conversation fingerprints, and other lead IDs before sending', async () => {
    await expect(prepareFollowUpSend('org','user','suggestion','old-version','lead')).rejects.toMatchObject({ statusCode: 409 })
    await expect(prepareFollowUpSend('org','user','suggestion','version','other-lead')).rejects.toThrow()
    mocks.fetchConversation.mockResolvedValue({ ...conversation, fingerprint: 'changed' })
    await expect(prepareFollowUpSend('org','user','suggestion','version','lead')).rejects.toMatchObject({ statusCode: 409 })
  })
})
