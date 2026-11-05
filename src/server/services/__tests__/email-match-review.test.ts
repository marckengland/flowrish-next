import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => {
  const db = { user: { findUnique: vi.fn() }, organizationMember: { findUnique: vi.fn() }, emailAccount: { findFirst: vi.fn(), findMany: vi.fn() }, emailMessage: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() }, activity: { findUnique: vi.fn() }, lead: { findMany: vi.fn() }, auditEntry: { create: vi.fn() }, $queryRaw: vi.fn() }
  return { db, transaction: vi.fn(), match: vi.fn(), lock: vi.fn(), commit: vi.fn(), enabled: vi.fn(), filter: vi.fn(), permission: vi.fn() }
})
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: m.transaction } }))
vi.mock('../email-lead-matcher', async original => ({ ...await original<typeof import('../email-lead-matcher')>(), matchEmailLead: m.match, lockEmailMatch: m.lock }))
vi.mock('../email-routing', async original => ({ ...await original<typeof import('../email-routing')>(), commitEmailRoute: m.commit }))
vi.mock('../email-routing-policy', () => ({ emailRoutingEnabled: m.enabled }))
vi.mock('../access', () => ({ getLeadAccessFilter: m.filter }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: m.permission }))
import { listEmailMatches, previewEmailMatch, resolveEmailMatch } from '../email-match-review'
const id = '550e8400-e29b-41d4-a716-446655440001', leadId = '550e8400-e29b-41d4-a716-446655440002'
const incoming = { externalId: 'external', threadId: 'thread', fromEmail: 'old@example.invalid', toEmail: 'owner@example.invalid', subject: 'Reply', bodyPreview: 'Call me', sentAt: '2026-11-05T00:00:00.000Z' }
const account = { id: 'account', organizationId: 'org', userId: 'owner', email: incoming.toEmail, provider: 'gmail' }
const pending = { state: 'PENDING', reason: 'AMBIGUOUS', ownerId: 'owner', mailboxEmail: account.email, provider: 'gmail', address: incoming.fromEmail, at: incoming.sentAt }
const record = () => ({ id, accountId: account.id, organizationId: 'org', ...incoming, sentAt: new Date(incoming.sentAt), replyMetadata: incoming, leadRouting: pending })
const target = { id: leadId, firstName: 'Practice', lastName: 'Clinic', email: 'new@example.invalid', mergedIntoId: null }
const match = { sources: [{ id: 'archive', mergedIntoId: leadId }], targets: [target], blocked: true, reason: 'AMBIGUOUS' }
const requestId = '550e8400-e29b-41d4-a716-446655440003'
beforeEach(() => {
  vi.resetAllMocks(); m.transaction.mockImplementation(async fn => fn(m.db)); m.enabled.mockReturnValue(true); m.db.$queryRaw.mockResolvedValue([{ id: 'member' }]); m.db.organizationMember.findUnique.mockResolvedValue({ id: 'member' }); m.db.user.findUnique.mockResolvedValue({ id: 'owner', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [] }); m.filter.mockResolvedValue({ deletedAt: null }); m.db.emailAccount.findFirst.mockResolvedValue(account); m.db.emailAccount.findMany.mockResolvedValue([account]); m.db.emailMessage.findFirst.mockResolvedValue(record()); m.db.emailMessage.findMany.mockResolvedValue([record()]); m.db.activity.findUnique.mockResolvedValue(null); m.db.lead.findMany.mockResolvedValue([target]); m.match.mockResolvedValue(match); m.lock.mockResolvedValue(match); m.commit.mockResolvedValue({ stopped: 1, suggestionCreated: true })
})
it('lists only messages owned by the current mailbox and previews only accessible candidates', async () => {
  expect(await listEmailMatches('org', 'owner')).toHaveLength(1)
  expect(m.db.emailAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org', userId: 'owner' } }))
  expect(m.db.emailMessage.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: 'org', accountId: { in: ['account'] } })
  const preview = await previewEmailMatch('org', 'owner', id)
  expect(preview.candidates).toEqual([{ id: leadId, label: 'Practice Clinic', email: target.email, canLink: true, viaArchive: true }]); expect(preview.version).toMatch(/^[a-f0-9]{64}$/)
  m.db.lead.findMany.mockResolvedValue([]); const hidden = await previewEmailMatch('org', 'owner', id); expect(hidden.candidates).toEqual([]); expect(hidden.restrictedMatches).toBe(true); expect(JSON.stringify(hidden)).not.toContain('Practice Clinic')
})
it('requires a current candidate and version, then stores a replay receipt without sending', async () => {
  const preview = await previewEmailMatch('org', 'owner', id)
  const action = { action: 'link', requestId, expectedVersion: preview.version, leadId, confirmed: true }
  const result = await resolveEmailMatch('org', 'owner', id, action)
  expect(result).toMatchObject({ messageId: id, leadId, stopped: 1, suggestionCreated: true }); expect(m.commit).toHaveBeenCalledWith(m.db, expect.objectContaining({ id }), account, incoming, target, 'MANUAL')
  const routing = m.db.emailMessage.update.mock.calls[0][0].data.leadRouting
  expect(routing).toMatchObject({ state: 'ROUTED', mode: 'MANUAL', receipt: { requestId, expectedVersion: preview.version } })
  m.db.emailMessage.findFirst.mockResolvedValue({ ...record(), leadRouting: routing }); m.commit.mockClear(); m.db.emailMessage.update.mockClear()
  expect(await resolveEmailMatch('org', 'owner', id, action)).toEqual(result); expect(m.commit).not.toHaveBeenCalled(); expect(m.db.emailMessage.update).not.toHaveBeenCalled()
  await expect(resolveEmailMatch('org', 'owner', id, { ...action, requestId: '550e8400-e29b-41d4-a716-446655440004' })).rejects.toMatchObject({ statusCode: 409 })
})
it('rejects stale reviews, hidden leads and changed ownership before effects', async () => {
  const preview = await previewEmailMatch('org', 'owner', id), action = { action: 'link', requestId, expectedVersion: preview.version, leadId, confirmed: true }
  await expect(resolveEmailMatch('org', 'owner', id, { ...action, expectedVersion: '0'.repeat(64) })).rejects.toMatchObject({ statusCode: 409 })
  m.db.lead.findMany.mockResolvedValue([]); await expect(resolveEmailMatch('org', 'owner', id, action)).rejects.toMatchObject({ statusCode: 409 })
  m.db.emailAccount.findFirst.mockResolvedValue({ ...account, userId: 'other' }); await expect(resolveEmailMatch('org', 'owner', id, action)).rejects.toMatchObject({ statusCode: 404 }); expect(m.commit).not.toHaveBeenCalled()
})
it('dismisses explicitly without activity or cadence effects, and pauses resolution for recovery', async () => {
  const preview = await previewEmailMatch('org', 'owner', id)
  await resolveEmailMatch('org', 'owner', id, { action: 'dismiss', requestId, expectedVersion: preview.version, confirmed: true }); expect(m.commit).not.toHaveBeenCalled(); expect(m.db.emailMessage.update.mock.calls[0][0].data.leadRouting.state).toBe('DISMISSED')
  m.enabled.mockReturnValue(false); await expect(resolveEmailMatch('org', 'owner', id, { action: 'dismiss', requestId, expectedVersion: preview.version, confirmed: true })).rejects.toMatchObject({ statusCode: 503 })
})
it('does not overwrite an existing association and propagates audit failure for rollback', async () => {
  m.db.activity.findUnique.mockResolvedValue({ id: 'existing', leadId: 'other' }); const preview = await previewEmailMatch('org', 'owner', id); expect(preview.candidates[0].canLink).toBe(false)
  await expect(resolveEmailMatch('org', 'owner', id, { action: 'link', requestId, expectedVersion: preview.version, leadId, confirmed: true })).rejects.toMatchObject({ statusCode: 409 }); expect(m.commit).not.toHaveBeenCalled()
  m.db.auditEntry.create.mockRejectedValue(new Error('audit failed')); await expect(resolveEmailMatch('org', 'owner', id, { action: 'dismiss', requestId, expectedVersion: preview.version, confirmed: true })).rejects.toBeDefined(); expect(m.db.emailMessage.update).not.toHaveBeenCalled()
})
it('rolls back resolution when write access is revoked during workflow-row waits', async () => {
  const preview = await previewEmailMatch('org', 'owner', id)
  m.commit.mockImplementation(async () => { m.permission.mockImplementation(() => { throw Object.assign(new Error('Access revoked'), { statusCode: 403 }) }); return { stopped: 1, suggestionCreated: true } })
  await expect(resolveEmailMatch('org', 'owner', id, { action: 'link', requestId, expectedVersion: preview.version, leadId, confirmed: true })).rejects.toMatchObject({ statusCode: 403 }); expect(m.db.emailMessage.update).not.toHaveBeenCalled()
})
it('rolls back if a role change narrows lead access during workflow waits even when write permission remains', async () => {
  const preview = await previewEmailMatch('org', 'owner', id)
  m.commit.mockImplementation(async () => { m.filter.mockResolvedValue({ deletedAt: null, assignedUserId: 'owner' }); m.db.lead.findMany.mockResolvedValue([]); return { stopped: 1, suggestionCreated: true } })
  await expect(resolveEmailMatch('org', 'owner', id, { action: 'link', requestId, expectedVersion: preview.version, leadId, confirmed: true })).rejects.toMatchObject({ statusCode: 409 }); expect(m.db.emailMessage.update).not.toHaveBeenCalled()
})
