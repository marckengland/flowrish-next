import { describe, expect, it, vi, beforeEach } from 'vitest'
const mocks = vi.hoisted(() => {
  const tx = {
    organizationMember: { findUnique: vi.fn() },
    followUpSuggestion: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), createMany: vi.fn() },
    lead: { findFirst: vi.fn(), findMany: vi.fn() },
    task: { create: vi.fn(), findFirst: vi.fn() },
    auditEntry: { create: vi.fn() },
    emailAccount: { findFirst: vi.fn() },
    cadenceEnrollment: { findMany: vi.fn(), updateMany: vi.fn() },
  }
  return { tx, transaction: vi.fn() }
})
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: mocks.transaction } }))
import { isHumanReply, reviewFollowUp, reconcileEmailReplies } from '../follow-ups'

const incoming = { externalId: 'message-1', threadId: 'thread-1', fromEmail: 'LEAD@example.com', toEmail: 'rep@example.com', subject: 'Re: Hello', bodyPreview: 'Please call tomorrow', sentAt: '2026-11-02T03:00:00.000Z' }
const enrollment = { emailThreadId: 'thread-1', enrolledAt: new Date('2026-11-01T03:00:00Z') }
const account = { email: 'rep@example.com', userId: 'rep', provider: 'gmail' }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx))
  mocks.tx.organizationMember.findUnique.mockResolvedValue({ userId: 'rep' })
  mocks.tx.lead.findFirst.mockResolvedValue({ id: 'lead' })
  mocks.tx.lead.findMany.mockResolvedValue([{ id: 'lead', firstName: 'Jane' }])
  mocks.tx.emailAccount.findFirst.mockResolvedValue(account)
  mocks.tx.cadenceEnrollment.findMany.mockResolvedValue([{ id: 'enrollment', ...enrollment }])
  mocks.tx.cadenceEnrollment.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.followUpSuggestion.findFirst.mockResolvedValue({ id: 'suggestion', status: 'PENDING', leadId: 'lead', assigneeId: 'rep', title: 'Follow up', description: 'Call tomorrow', taskId: null })
  mocks.tx.followUpSuggestion.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.followUpSuggestion.update.mockResolvedValue({ id: 'suggestion', status: 'APPROVED', taskId: 'task' })
  mocks.tx.followUpSuggestion.createMany.mockResolvedValue({ id: 'suggestion' })
  mocks.tx.task.create.mockResolvedValue({ id: 'task' })
})

describe('human reply detection', () => {
  it('accepts an inbound message in the enrolled thread after enrollment', () => {
    expect(isHumanReply(incoming, account.email, enrollment)).toBe(true)
  })
  it.each([
    { ...incoming, fromEmail: 'rep@example.com', toEmail: 'lead@example.com' },
    { ...incoming, toEmail: 'someone@example.com' },
    { ...incoming, threadId: 'different' },
    { ...incoming, sentAt: '2026-10-01T00:00:00Z' },
    { ...incoming, sentAt: 'invalid' },
    { ...incoming, fromEmail: 'mailer-daemon@example.com' },
    { ...incoming, headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }] },
    { ...incoming, headers: [{ name: 'Content-Type', value: 'multipart/report; report-type=delivery-status' }] },
  ])('ignores non-replies and automated mail: %j', (message) => {
    expect(isHumanReply(message, account.email, enrollment)).toBe(false)
  })
})

describe('review follow-up', () => {
  it('approves the edited task and writes an audit in one transaction', async () => {
    await reviewFollowUp('org', 'rep', 'suggestion', { action: 'approve', title: 'Edited title', description: 'Edited notes', dueDate: '2026-11-03T10:00:00Z' })
    expect(mocks.tx.task.create).toHaveBeenCalledWith({ data: expect.objectContaining({ organizationId: 'org', assigneeId: 'rep', leadId: 'lead', title: 'Edited title', description: 'Edited notes', dueDate: new Date('2026-11-03T10:00:00Z') }) })
    expect(mocks.tx.auditEntry.create).toHaveBeenCalled()
  })
  it('returns approved suggestions without creating another task', async () => {
    mocks.tx.followUpSuggestion.findFirst.mockResolvedValue({ id: 'suggestion', status: 'APPROVED', taskId: 'existing' })
    await reviewFollowUp('org', 'rep', 'suggestion', { action: 'approve' })
    expect(mocks.tx.task.create).not.toHaveBeenCalled()
  })
  it('dismisses without a task or email send', async () => {
    await reviewFollowUp('org', 'rep', 'suggestion', { action: 'dismiss' })
    expect(mocks.tx.task.create).not.toHaveBeenCalled()
    expect(mocks.tx.followUpSuggestion.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DISMISSED' }) }))
  })
  it('does not create a second task after losing the atomic claim', async () => {
    mocks.tx.followUpSuggestion.updateMany.mockResolvedValue({ count: 0 })
    await expect(reviewFollowUp('org', 'rep', 'suggestion', { action: 'approve' })).rejects.toThrow('already reviewed')
    expect(mocks.tx.task.create).not.toHaveBeenCalled()
  })
  it('rejects other users and tenants through the scoped lookup', async () => {
    mocks.tx.followUpSuggestion.findFirst.mockResolvedValue(null)
    await expect(reviewFollowUp('org', 'rep', 'other', { action: 'approve' })).rejects.toThrow('not found')
    expect(mocks.tx.followUpSuggestion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'other', organizationId: 'org', assigneeId: 'rep' } }))
    expect(mocks.tx.task.create).not.toHaveBeenCalled()
  })
  it('rejects deleted leads and departed members', async () => {
    mocks.tx.lead.findFirst.mockResolvedValue(null)
    await expect(reviewFollowUp('org', 'rep', 'suggestion', { action: 'approve' })).rejects.toThrow('lead')
    mocks.tx.lead.findFirst.mockResolvedValue({ id: 'lead' })
    mocks.tx.organizationMember.findUnique.mockResolvedValue(null)
    await expect(reviewFollowUp('org', 'rep', 'suggestion', { action: 'approve' })).rejects.toThrow('member')
    expect(mocks.tx.task.create).not.toHaveBeenCalled()
  })
  it('retains a valid receptionist callback task instead of duplicating it', async () => {
    mocks.tx.followUpSuggestion.findFirst.mockResolvedValue({ id: 'suggestion', status: 'PENDING', leadId: 'lead', taskId: 'callback-task' })
    mocks.tx.task.findFirst.mockResolvedValue({ id: 'callback-task' })
    await reviewFollowUp('org', 'rep', 'suggestion', { action: 'approve' })
    expect(mocks.tx.task.create).not.toHaveBeenCalled()
  })
})

describe('reply reconciliation', () => {
  it('stops only matching active/paused enrollments and captures a mailbox-scoped suggestion', async () => {
    await reconcileEmailReplies('org', 'account', [incoming])
    expect(mocks.tx.cadenceEnrollment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org', id: { in: ['enrollment'] } }), data: expect.objectContaining({ status: 'EXITED', exitReason: 'reply_received' }) }))
    expect(mocks.tx.followUpSuggestion.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org', assigneeId: 'rep', leadId: 'lead', sourceKey: JSON.stringify(['gmail', 'account', 'message-1']) }) }))
  })
  it('ignores ambiguous lead matches', async () => {
    mocks.tx.lead.findMany.mockResolvedValue([{ id: 'one' }, { id: 'two' }])
    await reconcileEmailReplies('org', 'account', [incoming])
    expect(mocks.tx.cadenceEnrollment.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.followUpSuggestion.createMany).not.toHaveBeenCalled()
  })
})
