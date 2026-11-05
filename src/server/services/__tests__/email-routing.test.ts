import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => {
  const tx = { emailAccount: { findFirst: vi.fn() }, organizationMember: { findUnique: vi.fn() }, emailMessage: { findUnique: vi.fn(), update: vi.fn() }, activity: { findUnique: vi.fn(), create: vi.fn() }, lead: { updateMany: vi.fn() }, cadenceEnrollment: { findMany: vi.fn(), updateMany: vi.fn() }, followUpSuggestion: { createMany: vi.fn() }, auditEntry: { create: vi.fn() }, $queryRaw: vi.fn() }
  return { tx, transaction: vi.fn(), match: vi.fn(), lock: vi.fn(), enabled: vi.fn() }
})
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: m.transaction } }))
vi.mock('@/server/services/email-lead-matcher', async importOriginal => ({ ...await importOriginal<typeof import('../email-lead-matcher')>(), matchEmailLead: m.match, lockEmailMatch: m.lock }))
vi.mock('@/server/services/email-routing-policy', () => ({ emailRoutingEnabled: m.enabled }))
import { reconcileStoredEmailReplies } from '../email-routing'
const incoming = { externalId: 'external', threadId: 'thread', fromEmail: 'old@example.invalid', toEmail: 'owner@example.invalid', recipientEmails: ['owner@example.invalid'], subject: 'Re: Proposal', bodyPreview: 'Please call', sentAt: '2026-11-05T00:00:00.000Z' }
const account = { id: 'account', organizationId: 'org', userId: 'owner', email: 'owner@example.invalid', provider: 'gmail' }
const stored = () => ({ id: 'message', organizationId: 'org', accountId: 'account', ...incoming, sentAt: new Date(incoming.sentAt), replyMetadata: incoming, leadRouting: null })
const match = () => ({ sources: [{ id: 'old', mergedIntoId: 'keep' }], targets: [{ id: 'keep', firstName: 'Practice' }], blocked: false, reason: null })
beforeEach(() => {
  vi.resetAllMocks(); m.transaction.mockImplementation(async action => action(m.tx)); m.enabled.mockReturnValue(true); m.tx.emailAccount.findFirst.mockResolvedValue(account); m.tx.organizationMember.findUnique.mockResolvedValue({ id: 'member' }); m.tx.$queryRaw.mockResolvedValue([{ id: 'member' }]); m.tx.emailMessage.findUnique.mockResolvedValue(stored()); m.tx.emailMessage.update.mockResolvedValue({}); m.tx.activity.findUnique.mockResolvedValue(null); m.tx.activity.create.mockResolvedValue({ id: 'activity' }); m.tx.lead.updateMany.mockResolvedValue({ count: 1 }); m.match.mockImplementation(async () => match()); m.lock.mockImplementation(async () => match()); m.tx.cadenceEnrollment.findMany.mockResolvedValue([{ id: 'enrollment', emailThreadId: 'thread', enrolledAt: new Date('2026-11-04') }]); m.tx.cadenceEnrollment.updateMany.mockResolvedValue({ count: 1 }); m.tx.followUpSuggestion.createMany.mockResolvedValue({ count: 1 }); m.tx.auditEntry.create.mockResolvedValue({})
})
it('links the retained lead, stops only matching mailbox-owner cadences, and leaves approval pending atomically', async () => {
  await reconcileStoredEmailReplies('org', 'account', [incoming], account)
  expect(m.tx.activity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ organizationId: 'org', leadId: 'keep', createdById: 'owner', emailMessageId: 'message', type: 'EMAIL' }) })
  expect(m.tx.cadenceEnrollment.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: 'org', leadId: 'keep', enrolledById: 'owner', emailThreadId: 'thread' }); expect(m.tx.cadenceEnrollment.updateMany.mock.calls[0][0].data.status).toBe('EXITED'); expect(m.tx.followUpSuggestion.createMany.mock.calls[0][0].data).toMatchObject({ leadId: 'keep', assigneeId: 'owner', status: 'PENDING', sourceKey: JSON.stringify(['gmail', 'account', 'external']) }); expect(m.tx.emailMessage.update.mock.calls[0][0].data.leadRouting).toMatchObject({ state: 'ROUTED', leadId: 'keep', mode: 'AUTO', address: 'old@example.invalid' })
})
it('holds ambiguous and unavailable matches without an activity, task, suggestion or cadence change', async () => {
  m.match.mockResolvedValue({ ...match(), targets: [{ id: 'keep' }, { id: 'other' }], blocked: true, reason: 'AMBIGUOUS' }); m.lock.mockImplementation(async () => m.match())
  await reconcileStoredEmailReplies('org', 'account', [incoming]); expect(m.tx.emailMessage.update.mock.calls[0][0].data.leadRouting).toMatchObject({ state: 'PENDING', reason: 'AMBIGUOUS' }); expect(m.tx.activity.create).not.toHaveBeenCalled(); expect(m.tx.cadenceEnrollment.updateMany).not.toHaveBeenCalled(); expect(m.tx.followUpSuggestion.createMany).not.toHaveBeenCalled()
})
it('keeps processed and pending decisions sticky and never duplicates their effects on replay', async () => {
  m.tx.emailMessage.findUnique.mockResolvedValue({ ...stored(), leadRouting: { state: 'ROUTED', ownerId: 'owner', mailboxEmail: account.email, provider: 'gmail', address: incoming.fromEmail, leadId: 'keep', mode: 'AUTO', at: incoming.sentAt } }); await reconcileStoredEmailReplies('org', 'account', [incoming]); expect(m.tx.activity.create).not.toHaveBeenCalled(); expect(m.tx.cadenceEnrollment.updateMany).not.toHaveBeenCalled(); expect(m.tx.emailMessage.update).not.toHaveBeenCalled()
})
it('retains an existing activity and holds a conflicting association for review', async () => {
  m.tx.activity.findUnique.mockResolvedValue({ id: 'existing', leadId: 'different' }); await reconcileStoredEmailReplies('org', 'account', [incoming]); expect(m.tx.emailMessage.update.mock.calls[0][0].data.leadRouting).toMatchObject({ state: 'PENDING', reason: 'EXISTING_LINK' }); expect(m.tx.activity.create).not.toHaveBeenCalled(); expect(m.tx.cadenceEnrollment.updateMany).not.toHaveBeenCalled()
})
it('does not stop cadences for automated, outgoing, stale or unrelated-thread mail', async () => {
  m.tx.emailMessage.findUnique.mockResolvedValue({ ...stored(), replyMetadata: { ...incoming, headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }] } }); await reconcileStoredEmailReplies('org', 'account', [incoming]); expect(m.tx.activity.create).toHaveBeenCalled(); expect(m.tx.cadenceEnrollment.updateMany).not.toHaveBeenCalled(); expect(m.tx.followUpSuggestion.createMany).not.toHaveBeenCalled()
})
it('rejects mailbox identity changes and departed members and rolls back a failing audit', async () => {
  await expect(reconcileStoredEmailReplies('org', 'account', [incoming], { ...account, email: 'different@example.invalid' })).rejects.toMatchObject({ statusCode: 409 }); expect(m.tx.activity.create).not.toHaveBeenCalled(); m.tx.organizationMember.findUnique.mockResolvedValue(null); await reconcileStoredEmailReplies('org', 'account', [incoming]); expect(m.tx.activity.create).not.toHaveBeenCalled(); m.tx.organizationMember.findUnique.mockResolvedValue({ id: 'member' }); m.tx.auditEntry.create.mockRejectedValue(new Error('Synthetic audit failure')); await expect(reconcileStoredEmailReplies('org', 'account', [incoming])).rejects.toBeDefined(); expect(m.tx.emailMessage.update).not.toHaveBeenCalled()
})
it('pauses all routing effects into held review when the recovery switch is disabled', async () => { m.enabled.mockReturnValue(false); await reconcileStoredEmailReplies('org', 'account', [incoming]); expect(m.tx.emailMessage.update.mock.calls[0][0].data.leadRouting).toMatchObject({ state: 'PENDING', reason: 'PAUSED' }); expect(m.tx.activity.create).not.toHaveBeenCalled(); expect(m.tx.cadenceEnrollment.updateMany).not.toHaveBeenCalled() })
it('rechecks matching after a message-row wait so a newly conflicting lead cannot be auto-linked', async () => {
  m.match.mockResolvedValueOnce(match()).mockResolvedValue({ ...match(), targets: [{ id: 'keep' }, { id: 'other' }], blocked: true, reason: 'AMBIGUOUS' })
  await expect(reconcileStoredEmailReplies('org', 'account', [incoming])).rejects.toMatchObject({ statusCode: 409 }); expect(m.tx.activity.create).not.toHaveBeenCalled(); expect(m.tx.cadenceEnrollment.updateMany).not.toHaveBeenCalled(); expect(m.tx.emailMessage.update).not.toHaveBeenCalled()
})
