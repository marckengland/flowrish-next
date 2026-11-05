import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() }, emailNotificationRead: { createMany: vi.fn(), findUnique: vi.fn() }, $queryRaw: vi.fn() }, tx: vi.fn(), permission: vi.fn(), filter: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: m.tx } }))
vi.mock('@/server/auth/permissions', () => ({ hasPermission: m.permission }))
vi.mock('../access', () => ({ getLeadAccessFilter: m.filter }))
import { countEmailNotifications, listEmailNotifications, readEmailNotification, focusedEmailFollowUp } from '../email-notifications'
const key = 'a'.repeat(64), messageId = '11111111-1111-4111-8111-111111111111', followUpId = '22222222-2222-4222-8222-222222222222', date = new Date('2026-11-05T00:00:00.000Z')
const row = { key, kind: 'email_match', messageId, followUpId: null, createdAt: date, readAt: null }
let rows: unknown[] = []
beforeEach(() => {
  vi.resetAllMocks(); rows = [row]; m.tx.mockImplementation(async fn => fn(m.db)); m.permission.mockReturnValue(true); m.filter.mockResolvedValue({ deletedAt: null, assignedUserId: 'owner' }); m.db.user.findUnique.mockResolvedValue({ id: 'owner', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [] }); m.db.$queryRaw.mockImplementation(async q => { const text = q.sql ?? q.join(''); if (text.includes('FOR KEY SHARE')) return [{ id: 'member' }]; if (text.includes('pg_advisory_xact_lock')) return []; if (text.includes('count(*)')) return [{ unread: 2 }]; return rows }); m.db.emailNotificationRead.findUnique.mockResolvedValue({ key, readAt: date })
})
it('counts and lists current eligible sources without writing and scopes read receipts to the owner', async () => {
  expect(await countEmailNotifications('org', 'owner')).toEqual({ unread: 2 }); expect(await listEmailNotifications('org', 'owner', { filter: 'unread', page: 1 })).toEqual({ rows: [{ ...row, createdAt: date.toISOString() }], page: 1, hasMore: false }); expect(m.db.emailNotificationRead.createMany).not.toHaveBeenCalled()
  const sql = m.db.$queryRaw.mock.calls.map(([q]) => q.sql ?? q.join('')).join('\n'); expect(sql).toContain('"leadRouting"'); expect(sql).toContain('"EmailAccount"'); expect(sql).toContain('"FollowUpSuggestion"'); expect(sql).toContain('"Activity"'); expect(sql).toContain('"OrganizationMember"'); expect(sql).toContain('LIMIT 21'); expect(sql).toContain('"assignedUserId"'); expect(sql).toContain('"readAt" IS NULL')
})
it('acknowledges idempotently with the first receipt and never changes source work', async () => {
  const first = await readEmailNotification('org', 'owner', key); const second = await readEmailNotification('org', 'owner', key); expect(first).toEqual({ key, readAt: date.toISOString() }); expect(second).toEqual(first); expect(m.db.emailNotificationRead.createMany).toHaveBeenCalledWith({ data: { organizationId: 'org', userId: 'owner', key }, skipDuplicates: true }); expect(m.db.emailNotificationRead.findUnique).toHaveBeenCalledWith({ where: { organizationId_userId_key: { organizationId: 'org', userId: 'owner', key } } })
})
it('returns zero/no rows without lead-read permission and refuses acknowledgments', async () => {
  m.permission.mockReturnValue(false); expect(await countEmailNotifications('org', 'owner')).toEqual({ unread: 0 }); expect((await listEmailNotifications('org', 'owner', {})).rows).toEqual([]); await expect(readEmailNotification('org', 'owner', key)).rejects.toMatchObject({ statusCode: 403 }); expect(m.db.emailNotificationRead.createMany).not.toHaveBeenCalled()
})
it('rejects departed members, absent sources, malformed pagination and unknown receipt keys', async () => {
  m.db.user.findUnique.mockResolvedValue(null); await expect(countEmailNotifications('org', 'owner')).rejects.toMatchObject({ statusCode: 403 }); m.db.user.findUnique.mockResolvedValue({ id: 'owner', organizationMemberships: [{ organizationId: 'org' }] }); rows = []; await expect(readEmailNotification('org', 'owner', key)).rejects.toMatchObject({ statusCode: 404 }); await expect(listEmailNotifications('org', 'owner', { page: 0 })).rejects.toBeDefined(); await expect(readEmailNotification('org', 'owner', 'bad')).rejects.toBeDefined(); expect(m.db.emailNotificationRead.createMany).not.toHaveBeenCalled()
})
it('rechecks current eligibility after receipt waits and rejects a resolved or inaccessible source', async () => {
  m.db.emailNotificationRead.createMany.mockImplementation(async () => { rows = []; return { count: 1 } }); await expect(readEmailNotification('org', 'owner', key)).rejects.toMatchObject({ statusCode: 404 })
})
it('reads a focused pending reply through the same eligibility source and strips draft fingerprints', async () => {
  rows = [{ ...row, kind: 'email_reply', followUpId, id: followUpId, lead: { id: 'lead', firstName: 'Practice', lastName: 'Clinic', email: 'lead@example.invalid' }, draftContext: { accountId: 'account', provider: 'gmail', threadId: 'thread', recipientEmail: 'lead@example.invalid', mailboxEmail: 'owner@example.invalid', fingerprint: 'private', messageCount: 1, lastMessageAt: date.toISOString() } }]; const item = await focusedEmailFollowUp('org', 'owner', followUpId); expect(item.id).toBe(followUpId); expect(item.draftContext).not.toHaveProperty('fingerprint'); rows = []; await expect(focusedEmailFollowUp('org', 'owner', followUpId)).rejects.toMatchObject({ statusCode: 404 }); expect(m.db.emailNotificationRead.createMany).not.toHaveBeenCalled()
})
