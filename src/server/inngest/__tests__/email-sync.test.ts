import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the Inngest email sync function.
 *
 * Tests cover:
 * - Function configuration (id, retries, event trigger)
 * - Token refresh before fetching emails
 * - Fetching message list from Gmail API
 * - Skipping duplicate messages (by externalId)
 * - Creating EmailMessage records for new messages
 * - Linking emails to leads by email address
 * - Updating lastSyncAt on the EmailAccount
 * - Handling empty message list
 *
 * **Validates: Requirements 7.6, 14.2**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  $transaction: vi.fn(),
  emailAccount: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  emailMessage: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  lead: {
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  activity: {
    create: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['EmailAccount', 'EmailMessage', 'Lead', 'Activity'],
}))

vi.mock('@/server/db/client', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

const mockRefreshTokenIfNeeded = vi.fn()
vi.mock('@/server/services/microsoft-email', () => ({ listMicrosoftMessagesPage: vi.fn() }))
vi.mock('@/server/services/mailbox-sync', () => ({ beginMailboxSync: vi.fn(), completeMailboxSync: vi.fn(), failMailboxSync: vi.fn(), heartbeatMailboxSync: vi.fn() }))
vi.mock('@/server/services/follow-ups', () => ({ reconcileEmailReplies: vi.fn() }))

vi.mock('@/server/services/email', () => ({
  refreshTokenIfNeeded: (...args: unknown[]) => mockRefreshTokenIfNeeded(...args),
}))

vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn((val: string) => `decrypted_${val}`),
}))

vi.mock('../client', () => ({
  inngest: {
    createFunction: vi.fn((config, handler) => {
      return { config, trigger: config.triggers?.[0], handler }
    }),
  },
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Import after mocks
import { emailSyncFunction } from '../email-sync'
import { reconcileEmailReplies } from '@/server/services/follow-ups'
import { listMicrosoftMessagesPage as listMicrosoftMessages } from '@/server/services/microsoft-email'
import { beginMailboxSync, completeMailboxSync, failMailboxSync, heartbeatMailboxSync } from '@/server/services/mailbox-sync'

// ─── Test Helpers ────────────────────────────────────────────────────────────

const orgId = '550e8400-e29b-41d4-a716-446655440000'
const accountId = 'acc00000-0000-0000-0000-000000000001'
const userId = 'usr00000-0000-0000-0000-000000000001'

function createMockEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sync-event-id',
    data: {
      accountId,
      organizationId: orgId,
      ...overrides,
    },
  }
}

function createMockStep() {
  return {
    run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    sleep: vi.fn(),
  }
}

function createGmailMessageListResponse(messageIds: string[]) {
  return {
    ok: true,
    json: async () => ({
      messages: messageIds.map((id) => ({ id, threadId: `thread_${id}` })),
    }),
    text: async () => '',
  }
}

function createGmailMessageMetadataResponse(
  id: string,
  from: string,
  to: string,
  subject: string,
) {
  return {
    ok: true,
    json: async () => ({
      id,
      threadId: `thread_${id}`,
      internalDate: String(Date.now()),
      payload: {
        headers: [
          { name: 'From', value: from },
          { name: 'To', value: to },
          { name: 'Subject', value: subject },
        ],
      },
      snippet: `Preview of ${subject}`,
    }),
    text: async () => '',
  }
}

// Get the handler from the function definition
const handler = (emailSyncFunction as any).handler

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Email Sync Function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(beginMailboxSync).mockResolvedValue(new Date('2026-11-02T04:00:00.000Z'))
    mockDb.$transaction.mockImplementation(async (fn: (db: typeof mockDb) => unknown) => fn(mockDb))
  })

  describe('function configuration', () => {
    it('should be configured with id "email-sync"', () => {
      expect((emailSyncFunction as any).config.id).toBe('email-sync')
    })

    it('should be configured with retries: 3', () => {
      expect((emailSyncFunction as any).config.retries).toBe(3)
    })

    it('should listen to "email/sync.requested" event', () => {
      expect((emailSyncFunction as any).trigger.event).toBe('email/sync.requested')
    })
  })

  describe('token refresh', () => {
    it('should refresh token before fetching emails', async () => {
      const mockStep = createMockStep()
      mockRefreshTokenIfNeeded.mockResolvedValue(undefined)
      mockDb.emailAccount.findFirst.mockResolvedValue({
        id: accountId,
        email: 'user@example.com',
        accessToken: 'encrypted_token',
        userId,
      })
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [] }),
        text: async () => '',
      })
      mockDb.emailAccount.update.mockResolvedValue({})

      await handler({ event: createMockEvent(), step: mockStep })

      expect(mockRefreshTokenIfNeeded).toHaveBeenCalledWith(accountId, orgId)
    })

    it('should throw when email account is not found', async () => {
      const mockStep = createMockStep()
      mockRefreshTokenIfNeeded.mockResolvedValue(undefined)
      mockDb.emailAccount.findFirst.mockResolvedValue(null)

      await expect(
        handler({ event: createMockEvent(), step: mockStep }),
      ).rejects.toThrow(`EmailAccount ${accountId} not found`)
    })
  })

  describe('message list fetching', () => {
    it('fetches 50 messages per page from the initial checkpoint window', async () => {
      const mockStep = createMockStep()
      mockRefreshTokenIfNeeded.mockResolvedValue(undefined)
      mockDb.emailAccount.findFirst.mockResolvedValue({
        id: accountId,
        email: 'user@example.com',
        accessToken: 'encrypted_token',
        userId,
      })
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [] }),
        text: async () => '',
      })
      mockDb.emailAccount.update.mockResolvedValue({})

      await handler({ event: createMockEvent(), step: mockStep })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/maxResults=50&q=after%3A\d+/),
        expect.objectContaining({
          headers: { Authorization: 'Bearer decrypted_encrypted_token' },
        }),
      )
    })

    it('should return synced: 0 when no messages found', async () => {
      const mockStep = createMockStep()
      mockRefreshTokenIfNeeded.mockResolvedValue(undefined)
      mockDb.emailAccount.findFirst.mockResolvedValue({
        id: accountId,
        email: 'user@example.com',
        accessToken: 'encrypted_token',
        userId,
      })
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ messages: undefined }),
        text: async () => '',
      })
      mockDb.emailAccount.update.mockResolvedValue({})

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(result).toEqual({ synced: 0, skipped: 0 })
    })

    it('should throw when Gmail API returns error', async () => {
      const mockStep = createMockStep()
      mockRefreshTokenIfNeeded.mockResolvedValue(undefined)
      mockDb.emailAccount.findFirst.mockResolvedValue({
        id: accountId,
        email: 'user@example.com',
        accessToken: 'encrypted_token',
        userId,
      })
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({}),
        status: 401,
        text: async () => 'Unauthorized',
      })

      await expect(
        handler({ event: createMockEvent(), step: mockStep }),
      ).rejects.toThrow('Gmail mailbox request failed (401)')
    })
  })

  describe('message processing', () => {
    it('should skip messages that already exist (by externalId)', async () => {
      const mockStep = createMockStep()
      mockRefreshTokenIfNeeded.mockResolvedValue(undefined)
      mockDb.emailAccount.findFirst.mockResolvedValue({
        id: accountId,
        email: 'user@example.com',
        accessToken: 'encrypted_token',
        userId,
      })

      // First call: message list
      mockFetch.mockResolvedValueOnce(createGmailMessageListResponse(['msg-1']))

      // Message already exists
      mockDb.emailMessage.findFirst.mockResolvedValueOnce({ id: 'existing-id' })
      mockDb.emailAccount.update.mockResolvedValue({})

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(result).toEqual({ synced: 0, skipped: 1 })
      expect(mockDb.emailMessage.create).not.toHaveBeenCalled()
    })

    it('should create EmailMessage record for new messages', async () => {
      const mockStep = createMockStep()
      mockRefreshTokenIfNeeded.mockResolvedValue(undefined)
      mockDb.emailAccount.findFirst.mockResolvedValue({
        id: accountId,
        email: 'user@example.com',
        accessToken: 'encrypted_token',
        userId,
      })

      // First call: message list
      mockFetch.mockResolvedValueOnce(createGmailMessageListResponse(['msg-1']))
      // Second call: message metadata
      mockFetch.mockResolvedValueOnce(
        createGmailMessageMetadataResponse(
          'msg-1',
          'sender@example.com',
          'user@example.com',
          'Test Subject',
        ),
      )

      // Message does not exist
      mockDb.emailMessage.findFirst.mockResolvedValueOnce(null)
      mockDb.emailMessage.create.mockResolvedValue({ id: 'new-msg-id' })
      // No matching lead
      mockDb.lead.findMany.mockResolvedValue([])
      mockDb.emailAccount.update.mockResolvedValue({})

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(result).toEqual({ synced: 1, skipped: 0 })
      expect(mockDb.emailMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountId,
          externalId: 'msg-1',
          threadId: 'thread_msg-1',
          fromEmail: 'sender@example.com',
          toEmail: 'user@example.com',
          subject: 'Test Subject',
        }),
      })
    })

    it('should link email to lead when email address matches', async () => {
      const mockStep = createMockStep()
      const leadId = 'lead-001'
      mockRefreshTokenIfNeeded.mockResolvedValue(undefined)
      mockDb.emailAccount.findFirst.mockResolvedValue({
        id: accountId,
        email: 'user@example.com',
        accessToken: 'encrypted_token',
        userId,
      })

      // First call: message list
      mockFetch.mockResolvedValueOnce(createGmailMessageListResponse(['msg-1']))
      // Second call: message metadata (incoming email from lead)
      mockFetch.mockResolvedValueOnce(
        createGmailMessageMetadataResponse(
          'msg-1',
          'lead@company.com',
          'user@example.com',
          'Re: Follow up',
        ),
      )

      // Message does not exist
      mockDb.emailMessage.findFirst.mockResolvedValueOnce(null)
      mockDb.emailMessage.create.mockResolvedValue({ id: 'new-msg-id' })
      // Lead matches by email
      mockDb.lead.findMany.mockResolvedValue([{ id: leadId }])
      mockDb.activity.create.mockResolvedValue({ id: 'activity-1' })
      mockDb.lead.update.mockResolvedValue({})
      mockDb.emailAccount.update.mockResolvedValue({})

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(result).toEqual({ synced: 1, skipped: 0 })
      expect(mockDb.lead.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          deletedAt: null,
          OR: [
            { email: { equals: 'lead@company.com', mode: 'insensitive' } },
            { altEmail: { equals: 'lead@company.com', mode: 'insensitive' } },
          ],
        }),
        select: { id: true }, take: 2,
      })
      expect(mockDb.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'EMAIL',
          leadId,
          createdById: userId,
        }),
      })
      expect(mockDb.lead.updateMany).toHaveBeenCalledWith({
        where: { id: leadId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: expect.any(Date) } }] },
        data: { lastActivityAt: expect.any(Date) },
      })
    })

    it('should match outgoing emails to leads by toEmail', async () => {
      const mockStep = createMockStep()
      const leadId = 'lead-002'
      mockRefreshTokenIfNeeded.mockResolvedValue(undefined)
      mockDb.emailAccount.findFirst.mockResolvedValue({
        id: accountId,
        email: 'user@example.com',
        accessToken: 'encrypted_token',
        userId,
      })

      // First call: message list
      mockFetch.mockResolvedValueOnce(createGmailMessageListResponse(['msg-2']))
      // Second call: message metadata (outgoing email to lead)
      mockFetch.mockResolvedValueOnce(
        createGmailMessageMetadataResponse(
          'msg-2',
          'user@example.com',
          'lead@company.com',
          'Proposal',
        ),
      )

      // Message does not exist
      mockDb.emailMessage.findFirst.mockResolvedValueOnce(null)
      mockDb.emailMessage.create.mockResolvedValue({ id: 'new-msg-id' })
      // Lead matches by email
      mockDb.lead.findMany.mockResolvedValue([{ id: leadId }])
      mockDb.activity.create.mockResolvedValue({ id: 'activity-2' })
      mockDb.lead.update.mockResolvedValue({})
      mockDb.emailAccount.update.mockResolvedValue({})

      await handler({ event: createMockEvent(), step: mockStep })

      // For outgoing emails (from = account email), should match by toEmail
      expect(mockDb.lead.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          OR: [
            { email: { equals: 'lead@company.com', mode: 'insensitive' } },
            { altEmail: { equals: 'lead@company.com', mode: 'insensitive' } },
          ],
        }),
        select: { id: true }, take: 2,
      })
    })

    it('skips metadata only when the provider reports the message was deleted', async () => {
      const mockStep = createMockStep()
      mockRefreshTokenIfNeeded.mockResolvedValue(undefined)
      mockDb.emailAccount.findFirst.mockResolvedValue({
        id: accountId,
        email: 'user@example.com',
        accessToken: 'encrypted_token',
        userId,
      })

      // First call: message list with 2 messages
      mockFetch.mockResolvedValueOnce(createGmailMessageListResponse(['msg-1', 'msg-2']))
      // msg-1 metadata fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
        status: 404,
        text: async () => 'Not Found',
      })
      // msg-2 metadata succeeds
      mockFetch.mockResolvedValueOnce(
        createGmailMessageMetadataResponse(
          'msg-2',
          'sender@example.com',
          'user@example.com',
          'Hello',
        ),
      )

      // Neither message exists
      mockDb.emailMessage.findFirst.mockResolvedValue(null)
      mockDb.emailMessage.create.mockResolvedValue({ id: 'new-msg-id' })
      mockDb.lead.findMany.mockResolvedValue([])
      mockDb.emailAccount.update.mockResolvedValue({})

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(result).toEqual({ synced: 1, skipped: 1 })
    })
  })

  describe('reply reconciliation', () => {
    const reply = { externalId: 'message', threadId: 'thread', fromEmail: 'lead@example.com', toEmail: 'rep@example.com', subject: 'Re: Meeting', bodyPreview: 'Tomorrow works', sentAt: '2026-11-02T03:00:00Z', headers: [{ name: 'Auto-Submitted', value: 'no' }] }
    it('replays persisted metadata after a previous sync committed before reply processing', async () => {
      mockDb.emailAccount.findFirst.mockResolvedValue({ id: accountId, email: 'rep@example.com', userId, provider: 'gmail', accessToken: 'encrypted' })
      mockFetch.mockResolvedValueOnce(createGmailMessageListResponse(['message']))
      mockDb.emailMessage.findFirst.mockResolvedValueOnce({ id: 'saved', replyMetadata: reply })
      const result = await handler({ event: createMockEvent(), step: createMockStep() })
      expect(result).toEqual({ synced: 0, skipped: 1 })
      expect(mockDb.emailMessage.findFirst).toHaveBeenCalledWith({ where: { accountId, externalId: 'message' } })
      expect(reconcileEmailReplies).toHaveBeenCalledWith(orgId, accountId, [reply])
      expect(mockDb.activity.create).not.toHaveBeenCalled()
    })
    it('adopts exact legacy inbound history without duplicating the email or activity', async () => {
      mockDb.emailAccount.findFirst.mockResolvedValue({ id: accountId, email: 'rep@example.com', userId, provider: 'microsoft', accessToken: 'encrypted' })
      vi.mocked(listMicrosoftMessages).mockResolvedValue({ messages: [reply] })
      mockDb.emailMessage.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'legacy', accountId: null })
      mockDb.emailMessage.update.mockResolvedValue({ id: 'legacy' })
      await handler({ event: createMockEvent(), step: createMockStep() })
      expect(mockDb.emailMessage.update).toHaveBeenCalledWith({ where: { id: 'legacy' }, data: { accountId, replyMetadata: reply } })
      expect(mockDb.emailMessage.create).not.toHaveBeenCalled()
      expect(mockDb.activity.create).not.toHaveBeenCalled()
      expect(reconcileEmailReplies).toHaveBeenCalledWith(orgId, accountId, [reply])
    })
    it('feeds Microsoft headers and recipients through the same normalized reply processor', async () => {
      mockDb.emailAccount.findFirst.mockResolvedValue({ id: accountId, email: 'rep@example.com', userId, provider: 'microsoft', accessToken: 'encrypted' })
      vi.mocked(listMicrosoftMessages).mockResolvedValue({ messages: [{ ...reply, recipientEmails: ['rep@example.com'] }] })
      mockDb.emailMessage.findFirst.mockResolvedValue(null)
      mockDb.emailMessage.create.mockResolvedValue({ id: 'saved' })
      mockDb.lead.findMany.mockResolvedValue([])
      await handler({ event: createMockEvent(), step: createMockStep() })
      expect(reconcileEmailReplies).toHaveBeenCalledWith(orgId, accountId, [{ ...reply, recipientEmails: ['rep@example.com'] }])
      expect(mockDb.emailMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accountId, replyMetadata: expect.objectContaining({ headers: reply.headers }) }) })
    })
    it('does not attach an ambiguous lead or create duplicate activities', async () => {
      mockDb.emailAccount.findFirst.mockResolvedValue({ id: accountId, email: 'rep@example.com', userId, provider: 'microsoft', accessToken: 'encrypted' })
      vi.mocked(listMicrosoftMessages).mockResolvedValue({ messages: [reply] })
      mockDb.emailMessage.findFirst.mockResolvedValue(null)
      mockDb.emailMessage.create.mockResolvedValue({ id: 'saved' })
      mockDb.lead.findMany.mockResolvedValue([{ id: 'one' }, { id: 'two' }])
      await handler({ event: createMockEvent(), step: createMockStep() })
      expect(mockDb.activity.create).not.toHaveBeenCalled()
    })
  })

  describe('lastSyncAt update', () => {
    it('should update lastSyncAt after processing messages', async () => {
      const mockStep = createMockStep()
      mockRefreshTokenIfNeeded.mockResolvedValue(undefined)
      mockDb.emailAccount.findFirst.mockResolvedValue({
        id: accountId,
        email: 'user@example.com',
        accessToken: 'encrypted_token',
        userId,
      })

      mockFetch.mockResolvedValueOnce(createGmailMessageListResponse(['msg-1']))
      mockFetch.mockResolvedValueOnce(
        createGmailMessageMetadataResponse(
          'msg-1',
          'sender@example.com',
          'user@example.com',
          'Test',
        ),
      )

      mockDb.emailMessage.findFirst.mockResolvedValueOnce(null)
      mockDb.emailMessage.create.mockResolvedValue({ id: 'new-msg-id' })
      mockDb.lead.findMany.mockResolvedValue([])
      mockDb.emailAccount.update.mockResolvedValue({})

      await handler({ event: createMockEvent(), step: mockStep })

      expect(completeMailboxSync).toHaveBeenCalledWith(orgId, accountId, 'sync-event-id', new Date('2026-11-02T04:00:00.000Z'))
    })

    it('should update lastSyncAt even when no messages found', async () => {
      const mockStep = createMockStep()
      mockRefreshTokenIfNeeded.mockResolvedValue(undefined)
      mockDb.emailAccount.findFirst.mockResolvedValue({
        id: accountId,
        email: 'user@example.com',
        accessToken: 'encrypted_token',
        userId,
      })
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ messages: undefined }),
        text: async () => '',
      })
      mockDb.emailAccount.update.mockResolvedValue({})

      await handler({ event: createMockEvent(), step: mockStep })

      expect(completeMailboxSync).toHaveBeenCalledWith(orgId, accountId, 'sync-event-id', new Date('2026-11-02T04:00:00.000Z'))
    })
  })
})

describe('automatic sync checkpoints and page failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(beginMailboxSync).mockResolvedValue(new Date('2026-11-02T04:00:00.000Z'))
    mockDb.$transaction.mockImplementation(async (fn: (db: typeof mockDb) => unknown) => fn(mockDb))
    mockDb.emailAccount.findFirst.mockResolvedValue({ id: accountId, email: 'rep@example.com', userId, provider: 'gmail', accessToken: 'encrypted', lastSyncAt: new Date('2026-11-02T03:00:00Z') })
    mockDb.emailMessage.findFirst.mockResolvedValue(null)
    mockDb.emailMessage.create.mockResolvedValue({ id: 'saved' })
    mockDb.lead.findMany.mockResolvedValue([])
  })
  it('persists and reconciles all Gmail pages before advancing to the stable run start', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'first' }], nextPageToken: 'next' }) })
      .mockResolvedValueOnce(createGmailMessageMetadataResponse('first', 'lead@example.com', 'rep@example.com', 'First'))
      .mockResolvedValueOnce(createGmailMessageListResponse(['second']))
      .mockResolvedValueOnce(createGmailMessageMetadataResponse('second', 'lead@example.com', 'rep@example.com', 'Second'))
    const step = createMockStep()
    expect(await handler({ event: createMockEvent(), step })).toEqual({ synced: 2, skipped: 0 })
    expect(mockDb.emailMessage.create).toHaveBeenCalledTimes(2)
    expect(reconcileEmailReplies).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[0][0]).toContain('q=after%3A1793588100')
    expect(mockFetch.mock.calls[2][0]).toContain('pageToken=next')
    expect(completeMailboxSync).toHaveBeenCalledWith(orgId, accountId, 'sync-event-id', new Date('2026-11-02T04:00:00.000Z'))
    expect(step.run.mock.calls.map(c => c[0])).toContain('sync-page-1')
  })
  it('does not advance the checkpoint on a transient message fetch failure', async () => {
    mockFetch.mockResolvedValueOnce(createGmailMessageListResponse(['first'])).mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'sensitive provider body' })
    await expect(handler({ event: createMockEvent(), step: createMockStep() })).rejects.toThrow('Gmail mailbox request failed (503)')
    expect(completeMailboxSync).not.toHaveBeenCalled()
  })
  it('does not advance the checkpoint when reply reconciliation fails', async () => {
    mockFetch.mockResolvedValueOnce(createGmailMessageListResponse([]))
    vi.mocked(reconcileEmailReplies).mockRejectedValueOnce(new Error('Synthetic reply write failure'))
    await expect(handler({ event: createMockEvent(), step: createMockStep() })).rejects.toThrow('Synthetic reply write failure')
    expect(completeMailboxSync).not.toHaveBeenCalled()
  })
  it('records final failure against the original run without exposing provider details', async () => {
    await (emailSyncFunction as any).config.onFailure({ event: { data: { event: createMockEvent() } }, error: new Error('secret-token') })
    expect(failMailboxSync).toHaveBeenCalledWith(orgId, accountId, 'sync-event-id')
  })
  it('ignores a queued event whose lease was superseded', async () => {
    vi.mocked(beginMailboxSync).mockRejectedValueOnce(Object.assign(new Error('Superseded'), { code: 'SYNC_SUPERSEDED' }))
    expect(await handler({ event: createMockEvent(), step: createMockStep() })).toEqual({ skipped: true, reason: 'sync_superseded' })
    expect(mockRefreshTokenIfNeeded).not.toHaveBeenCalled()
    expect(completeMailboxSync).not.toHaveBeenCalled()
  })
})

describe('durable pagination retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(beginMailboxSync).mockResolvedValue(new Date('2026-11-02T04:00:00.000Z'))
    mockDb.$transaction.mockImplementation(async (fn: (db: typeof mockDb) => unknown) => fn(mockDb))
    mockDb.emailAccount.findFirst.mockResolvedValue({ id: accountId, email: 'rep@example.com', userId, provider: 'gmail', accessToken: 'encrypted', lastSyncAt: null })
    mockDb.emailMessage.findFirst.mockResolvedValue(null)
    mockDb.emailMessage.create.mockResolvedValue({ id: 'saved' })
    mockDb.lead.findMany.mockResolvedValue([])
  })
  it('replays a failed page without repeating already committed pages or skipping its reply', async () => {
    const completed = new Map<string, unknown>()
    const step = { run: vi.fn(async (name: string, fn: () => Promise<unknown>) => {
      if (completed.has(name)) return completed.get(name)
      const result = await fn()
      // Inngest durable boundaries serialize data between invocations.
      completed.set(name, result === undefined ? undefined : JSON.parse(JSON.stringify(result)))
      return result
    }) }
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'first' }], nextPageToken: 'next' }) })
      .mockResolvedValueOnce(createGmailMessageMetadataResponse('first', 'lead@example.com', 'rep@example.com', 'First'))
      .mockRejectedValueOnce(new Error('Temporary page failure'))
    await expect(handler({ event: createMockEvent(), step })).rejects.toThrow('Temporary page failure')
    expect(completeMailboxSync).not.toHaveBeenCalled()
    mockFetch.mockResolvedValueOnce(createGmailMessageListResponse(['second']))
      .mockResolvedValueOnce(createGmailMessageMetadataResponse('second', 'lead@example.com', 'rep@example.com', 'Second'))
    expect(await handler({ event: createMockEvent(), step })).toEqual({ synced: 2, skipped: 0 })
    expect(mockDb.emailMessage.create).toHaveBeenCalledTimes(2)
    expect(reconcileEmailReplies).toHaveBeenCalledTimes(2)
    expect(completeMailboxSync).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })
  it('fails visibly without advancing the checkpoint when Gmail exceeds the page cap', async () => {
    let page = 0
    mockFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ messages: [], nextPageToken: `page-${page++}` }) }))
    await expect(handler({ event: createMockEvent(), step: createMockStep() })).rejects.toThrow('Mailbox sync page limit reached')
    expect(mockFetch).toHaveBeenCalledTimes(100)
    expect(completeMailboxSync).not.toHaveBeenCalled()
  })
})

describe('mailbox execution lease heartbeats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(beginMailboxSync).mockResolvedValue(new Date('2026-11-02T04:00:00.000Z'))
    mockDb.$transaction.mockImplementation(async (fn: (db: typeof mockDb) => unknown) => fn(mockDb))
    mockDb.emailAccount.findFirst.mockResolvedValue({ id: accountId, email: 'rep@example.com', userId, provider: 'gmail', accessToken: 'encrypted', lastSyncAt: null })
  })
  it('refreshes the lease before and after each executed page while retaining the run-start checkpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [], nextPageToken: 'next' }) })
      .mockResolvedValueOnce(createGmailMessageListResponse([]))
    expect(await handler({ event: createMockEvent(), step: createMockStep() })).toEqual({ synced: 0, skipped: 0 })
    expect(heartbeatMailboxSync).toHaveBeenCalledTimes(4)
    expect(heartbeatMailboxSync).toHaveBeenCalledWith(orgId, accountId, 'sync-event-id')
    expect(completeMailboxSync).toHaveBeenCalledWith(orgId, accountId, 'sync-event-id', new Date('2026-11-02T04:00:00.000Z'))
  })
  it('does not fetch or advance a checkpoint after losing its lease before a page', async () => {
    vi.mocked(heartbeatMailboxSync).mockRejectedValueOnce(Object.assign(new Error('Sync superseded'), { code: 'SYNC_SUPERSEDED' }))
    await expect(handler({ event: createMockEvent(), step: createMockStep() })).rejects.toThrow('Sync superseded')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(completeMailboxSync).not.toHaveBeenCalled()
  })
})
