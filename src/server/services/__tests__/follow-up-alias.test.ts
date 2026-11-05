import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ user: { findUnique: vi.fn() }, followUpSuggestion: { findFirst: vi.fn(), updateMany: vi.fn() }, lead: { findFirst: vi.fn() }, emailAccount: { findFirst: vi.fn() }, emailMessage: { findFirst: vi.fn() }, match: vi.fn(), conversation: vi.fn(), generate: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: m }))
vi.mock('../access', () => ({ getLeadAccessFilter: vi.fn(async () => ({ deletedAt: null })) }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: vi.fn() }))
vi.mock('@/server/auth/entitlements', () => ({ requireEntitlement: vi.fn() }))
vi.mock('../email-lead-matcher', () => ({ matchEmailLead: m.match }))
vi.mock('../email-conversation', () => ({ fetchEmailConversation: m.conversation }))
vi.mock('../ai', () => ({ generateConversationFollowUp: m.generate }))
import { generateFollowUpDraft } from '../follow-up-drafts'
const at = '2026-11-05T00:00:00.000Z'
const routing = { state: 'ROUTED', ownerId: 'user', mailboxEmail: 'owner@example.invalid', provider: 'gmail', address: 'old@example.invalid', leadId: 'lead', mode: 'AUTO', at }
const message = { id: 'message', fromEmail: routing.address, leadRouting: routing, activity: { leadId: 'lead', organizationId: 'org' } }
beforeEach(() => {
  vi.resetAllMocks(); m.user.findUnique.mockResolvedValue({ id: 'user', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [] }); m.followUpSuggestion.findFirst.mockResolvedValue({ id: 'suggestion', leadId: 'lead', sourceType: 'EMAIL', sourceId: 'external', sourceThreadId: 'thread', sourceKey: JSON.stringify(['gmail', 'account', 'external']), status: 'PENDING', updatedAt: new Date(at) }); m.followUpSuggestion.updateMany.mockResolvedValue({ count: 1 }); m.lead.findFirst.mockResolvedValue({ id: 'lead', email: 'current@example.invalid', altEmail: null }); m.emailAccount.findFirst.mockResolvedValue({ id: 'account', userId: 'user', email: routing.mailboxEmail, provider: 'gmail' }); m.emailMessage.findFirst.mockResolvedValue(message); m.match.mockResolvedValue({ targets: [{ id: 'lead' }], reason: null }); m.conversation.mockResolvedValue({ accountId: 'account', provider: 'gmail', threadId: 'thread', mailboxEmail: routing.mailboxEmail, recipientEmail: routing.address, subject: 'Proposal', fingerprint: 'fingerprint', messages: [{ sentAt: at }] }); m.generate.mockResolvedValue({ body: 'Mock reply' })
})
it('allows only the verified routed source alias through full-conversation drafting', async () => {
  const draft = await generateFollowUpDraft('org', 'user', 'suggestion'); expect(draft.context.recipientEmail).toBe(routing.address); expect(m.conversation).toHaveBeenCalledWith(expect.objectContaining({ leadEmails: ['current@example.invalid', routing.address] })); expect(m.match).toHaveBeenCalledWith(m, 'org', routing.address)
})
it.each([{ leadRouting: null }, { leadRouting: { ...routing, ownerId: 'other' } }, { leadRouting: { ...routing, mailboxEmail: 'other@example.invalid' } }, { leadRouting: { ...routing, address: 'unrelated@example.invalid' } }, { activity: { leadId: 'other', organizationId: 'org' } }])('rejects missing or unrelated routing proof before provider or AI calls: %j', async change => {
  m.emailMessage.findFirst.mockResolvedValue({ ...message, ...change }); await expect(generateFollowUpDraft('org', 'user', 'suggestion')).rejects.toMatchObject({ statusCode: 409 }); expect(m.conversation).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled()
})
it('rejects an alias whose current merge lineage no longer includes the suggestion lead', async () => { m.match.mockResolvedValue({ targets: [{ id: 'other' }], reason: null }); await expect(generateFollowUpDraft('org', 'user', 'suggestion')).rejects.toMatchObject({ statusCode: 409 }); expect(m.conversation).not.toHaveBeenCalled() })
