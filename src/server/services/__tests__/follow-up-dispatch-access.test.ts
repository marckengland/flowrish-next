import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() }, organizationMember: { findUnique: vi.fn() }, lead: { findFirst: vi.fn(), update: vi.fn() }, followUpSuggestion: { findFirst: vi.fn(), updateMany: vi.fn() }, emailAccount: { findFirst: vi.fn() }, emailMessage: { findFirst: vi.fn(), create: vi.fn() }, activity: { create: vi.fn() }, $queryRaw: vi.fn() }, tx: vi.fn(), conversation: vi.fn(), generate: vi.fn(), fetch: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { ...m.db, $transaction: m.tx } }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => m.db }))
vi.mock('../access', () => ({ getLeadAccessFilter: vi.fn(async () => ({ deletedAt: null, assignedUserId: 'actor' })) }))
vi.mock('@/server/auth/entitlements', () => ({ requireEntitlement: vi.fn() }))
vi.mock('../email-conversation', () => ({ fetchEmailConversation: m.conversation }))
vi.mock('../ai', () => ({ generateConversationFollowUp: m.generate }))
vi.mock('@/lib/env', () => ({ env: {} }))
vi.mock('@/lib/encryption', () => ({ encrypt: () => 'synthetic', decrypt: () => 'synthetic' }))
import { generateFollowUpDraft, prepareFollowUpSend, prepareFollowUpTemplateSend, verifyFollowUpTemplate } from '../follow-up-drafts'
import { sendEmail } from '../email'
const at = '2026-11-05T00:00:00.000Z'
const actor = (write = true) => ({ id: 'actor', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [{ role: { permissions: [{ key: 'leads:read' }, ...(write ? [{ key: 'leads:write' }] : [])] } }] })
const context = { accountId: 'account', provider: 'gmail', threadId: 'thread', mailboxEmail: 'owner@example.invalid', recipientEmail: 'lead@example.invalid', fingerprint: 'fingerprint', messageCount: 1, lastMessageAt: at }
const suggestion = { id: 'followup', organizationId: 'org', assigneeId: 'actor', leadId: 'lead', sourceType: 'EMAIL', sourceId: 'message', sourceThreadId: 'thread', sourceKey: JSON.stringify(['gmail', 'account', 'message']), status: 'PENDING', updatedAt: new Date(at), draftVersion: 'version', draftGeneratedAt: new Date(at), draftContext: context }
const account = { id: 'account', organizationId: 'org', userId: 'actor', provider: 'gmail', email: context.mailboxEmail, tokenExpiry: new Date('2099-01-01'), accessToken: 'synthetic' }
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', m.fetch); m.tx.mockImplementation(async fn => fn(m.db)); m.db.user.findUnique.mockResolvedValue(actor()); m.db.organizationMember.findUnique.mockResolvedValue({ id: 'member' }); m.db.$queryRaw.mockResolvedValue([{ id: 'lock' }]); m.db.lead.findFirst.mockResolvedValue({ id: 'lead', email: context.recipientEmail, altEmail: null, firstName: 'Practice', lastName: 'Clinic' }); m.db.followUpSuggestion.findFirst.mockResolvedValue(suggestion); m.db.followUpSuggestion.updateMany.mockResolvedValue({ count: 1 }); m.db.emailAccount.findFirst.mockResolvedValue(account); m.db.emailMessage.findFirst.mockResolvedValue({ id: 'stored', fromEmail: context.recipientEmail, activity: { leadId: 'lead', organizationId: 'org' }, leadRouting: null }); m.conversation.mockResolvedValue({ ...context, subject: 'Proposal', messages: [{ sentAt: at, messageId: '<message@example.invalid>' }] }); m.generate.mockResolvedValue({ body: 'Mock draft' }); m.fetch.mockResolvedValue(new Response(JSON.stringify({ id: 'sent', threadId: 'thread' }))) })
it('does not call AI after write access is revoked during conversation retrieval', async () => {
  m.conversation.mockImplementation(async () => { m.db.user.findUnique.mockResolvedValue(actor(false)); return { ...context, subject: 'Proposal', messages: [{ sentAt: at }] } }); await expect(generateFollowUpDraft('org', 'actor', 'followup')).rejects.toMatchObject({ statusCode: 403 }); expect(m.generate).not.toHaveBeenCalled(); expect(m.db.followUpSuggestion.updateMany).not.toHaveBeenCalled()
})
it('does not commit a generated draft if permission changes during its final database write', async () => {
  m.db.followUpSuggestion.updateMany.mockImplementation(async () => { m.db.user.findUnique.mockResolvedValue(actor(false)); return { count: 1 } }); await expect(generateFollowUpDraft('org', 'actor', 'followup')).rejects.toMatchObject({ statusCode: 403 })
})
it('revalidates normal-recipient follow-up delivery after token refresh before any transport', async () => {
  const prepared = await prepareFollowUpSend('org', 'actor', 'followup', 'version', 'lead'); let reads = 0; m.db.emailAccount.findFirst.mockImplementation(async query => { if (!query.select && !query.orderBy && ++reads === 2) m.db.user.findUnique.mockResolvedValue(actor(false)); return account }); await expect(sendEmail('lead', prepared.subject, 'Reviewed body', 'actor', 'org', prepared.threadId, [], prepared.options)).rejects.toMatchObject({ statusCode: 403 }); expect(m.fetch).not.toHaveBeenCalled(); expect(m.db.emailMessage.create).not.toHaveBeenCalled()
})
it('enforces current access on ordinary manual delivery after token refresh too', async () => {
  let reads = 0; m.db.emailAccount.findFirst.mockImplementation(async query => { if (!query.select && !query.orderBy && ++reads === 2) m.db.user.findUnique.mockResolvedValue(actor(false)); return account }); await expect(sendEmail('lead', 'Subject', 'Manual body', 'actor', 'org', undefined, [], { manualActor: true })).rejects.toMatchObject({ statusCode: 403 }); expect(m.fetch).not.toHaveBeenCalled()
})

it('binds a manually reviewed template to the original owned mailbox and current primary recipient without AI', async () => {
  const prepared = await prepareFollowUpTemplateSend('org', 'actor', 'followup', 'lead')
  expect(prepared.options).toEqual({ accountId: 'account', recipientEmail: context.recipientEmail, followUpTemplateId: 'followup' })
  await sendEmail('lead', 'Reviewed template', 'Reviewed body', 'actor', 'org', undefined, [], { ...prepared.options, manualActor: true })
  expect(m.fetch).toHaveBeenCalledOnce(); const payload = JSON.parse(m.fetch.mock.calls[0][1].body); expect(payload).not.toHaveProperty('threadId'); expect(Buffer.from(payload.raw, 'base64url').toString()).toContain('To: lead@example.invalid'); expect(m.generate).not.toHaveBeenCalled(); expect(m.conversation).not.toHaveBeenCalled()
})
it('rejects attempts to move a manual template to another mailbox, lead, recipient or thread', async () => {
  await expect(prepareFollowUpTemplateSend('org', 'actor', 'followup', 'other')).rejects.toMatchObject({ statusCode: 409 })
  for (const [mailbox, recipient, thread] of [['other', context.recipientEmail, undefined], ['account', 'stranger@example.invalid', undefined], ['account', context.recipientEmail, 'other-thread']]) await expect(verifyFollowUpTemplate('org', 'actor', 'followup', 'lead', mailbox, recipient!, thread)).rejects.toMatchObject({ statusCode: 409 })
  expect(m.fetch).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled()
})
it('rejects a dismissed template and refuses source messages whose activity moved to another lead', async () => {
  m.db.followUpSuggestion.findFirst.mockResolvedValue({ ...suggestion, status: 'DISMISSED' }); await expect(prepareFollowUpTemplateSend('org', 'actor', 'followup', 'lead')).rejects.toMatchObject({ statusCode: 404 }); m.db.followUpSuggestion.findFirst.mockResolvedValue(suggestion); m.db.emailMessage.findFirst.mockResolvedValue({ id: 'stored', fromEmail: context.recipientEmail, activity: { leadId: 'other', organizationId: 'org' }, leadRouting: null }); await expect(prepareFollowUpTemplateSend('org', 'actor', 'followup', 'lead')).rejects.toMatchObject({ statusCode: 409 }); expect(m.fetch).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled()
})
