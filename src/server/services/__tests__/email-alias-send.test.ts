import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ user: { findUnique: vi.fn() }, followUpSuggestion: { findFirst: vi.fn() }, lead: { findFirst: vi.fn(), update: vi.fn() }, activity: { create: vi.fn() }, emailAccount: { findFirst: vi.fn() }, emailMessage: { findFirst: vi.fn(), create: vi.fn() }, match: vi.fn(), conversation: vi.fn(), fetch: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: m }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => m }))
vi.mock('@/lib/env', () => ({ env: {} }))
vi.mock('@/lib/encryption', () => ({ decrypt: () => 'synthetic-unused-token', encrypt: () => 'synthetic-unused-token' }))
vi.mock('../access', () => ({ getLeadAccessFilter: vi.fn(async () => ({ deletedAt: null })) }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: vi.fn(), hasPermission: () => true }))
vi.mock('@/server/auth/entitlements', () => ({ requireEntitlement: vi.fn() }))
vi.mock('../email-lead-matcher', () => ({ matchEmailLead: m.match }))
vi.mock('../email-conversation', () => ({ fetchEmailConversation: m.conversation }))
vi.mock('../ai', () => ({ generateConversationFollowUp: vi.fn(() => { throw new Error('AI forbidden') }) }))
import { prepareFollowUpSend } from '../follow-up-drafts'
import { sendEmail } from '../email'
const at = '2026-11-05T00:00:00.000Z'
const context = { accountId: 'account', provider: 'gmail', threadId: 'thread', mailboxEmail: 'owner@example.invalid', recipientEmail: 'old@example.invalid', fingerprint: 'fingerprint', messageCount: 1, lastMessageAt: at }
const suggestion = { id: 'suggestion', leadId: 'lead', sourceType: 'EMAIL', sourceId: 'external', sourceThreadId: 'thread', sourceKey: JSON.stringify(['gmail', 'account', 'external']), status: 'PENDING', updatedAt: new Date(at), draftGeneratedAt: new Date(at), draftVersion: 'version', draftContext: context }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('fetch', m.fetch); m.fetch.mockResolvedValue(new Response(JSON.stringify({ id: 'mock-sent', threadId: 'thread' }))); m.user.findUnique.mockResolvedValue({ id: 'user', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [] }); m.followUpSuggestion.findFirst.mockResolvedValue(suggestion); m.lead.findFirst.mockResolvedValue({ id: 'lead', firstName: 'Practice', lastName: 'Clinic', email: 'current@example.invalid', altEmail: null }); m.emailAccount.findFirst.mockResolvedValue({ id: 'account', userId: 'user', email: context.mailboxEmail, provider: 'gmail', tokenExpiry: new Date('2099-01-01'), accessToken: 'synthetic' }); m.emailMessage.findFirst.mockResolvedValue({ id: 'message', fromEmail: context.recipientEmail, leadRouting: { state: 'ROUTED', ownerId: 'user', mailboxEmail: context.mailboxEmail, provider: 'gmail', address: context.recipientEmail, leadId: 'lead', mode: 'AUTO', at }, activity: { leadId: 'lead', organizationId: 'org' } }); m.match.mockResolvedValue({ targets: [{ id: 'lead' }], reason: null }); m.conversation.mockResolvedValue({ ...context, subject: 'Proposal', messages: [{ sentAt: at, messageId: '<source@example.invalid>' }] })
})
it('passes a verified merged-address draft through the real final send guard to a mocked transport', async () => {
  const prepared = await prepareFollowUpSend('org', 'user', 'suggestion', 'version', 'lead')
  await sendEmail('lead', prepared.subject, 'Reviewed reply', 'user', 'org', prepared.threadId, [], prepared.options)
  expect(m.fetch).toHaveBeenCalledOnce(); const body = JSON.parse(m.fetch.mock.calls[0][1].body); expect(Buffer.from(body.raw, 'base64url').toString()).toContain('To: old@example.invalid'); expect(m.emailMessage.create.mock.calls[0][0].data.toEmail).toBe(context.recipientEmail)
})
it('continues rejecting an arbitrary recipient without reviewed source proof', async () => { await expect(sendEmail('lead', 'Subject', 'Body', 'user', 'org', 'thread', [], { accountId: 'account', recipientEmail: 'stranger@example.invalid' })).rejects.toMatchObject({ code: 'INVALID_RECIPIENT' }); expect(m.fetch).not.toHaveBeenCalled() })
it('rechecks the reviewed version after token refresh before any delivery', async () => {
  const prepared = await prepareFollowUpSend('org', 'user', 'suggestion', 'version', 'lead'); let reads = 0; m.followUpSuggestion.findFirst.mockImplementation(async () => ++reads === 1 ? suggestion : { ...suggestion, draftVersion: 'changed' })
  await expect(sendEmail('lead', prepared.subject, 'Body', 'user', 'org', prepared.threadId, [], prepared.options)).rejects.toMatchObject({ statusCode: 409 }); expect(m.fetch).not.toHaveBeenCalled()
})
