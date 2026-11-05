import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
vi.mock('@/lib/env', () => ({ env: {} }))
vi.mock('@/lib/encryption', () => ({ encrypt: () => 'synthetic', decrypt: () => 'synthetic' }))
const fetchMock = vi.fn()
import { deliverMicrosoftEmail } from '../microsoft-email'
const input = { accessToken: 'synthetic', to: 'lead@example.invalid', subject: 'Subject', htmlBody: '<p>Reviewed body</p>', attachments: [] }
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockImplementation(async (_url, options) => new Response(JSON.stringify(options?.method === 'POST' ? { id: 'draft', conversationId: 'thread' } : { value: [{ id: 'source' }] }))) })
it('rechecks authorization after the conversation lookup before creating a reply draft', async () => {
  let checks = 0; const authorize = vi.fn(async () => { if (++checks === 2) throw new AppError('FORBIDDEN', 'Access revoked', 403) }); await expect(deliverMicrosoftEmail({ ...input, replyToConversationId: 'thread', strictReply: true, authorize })).rejects.toMatchObject({ statusCode: 403 }); expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
})
it('does not send a created provider draft after access is revoked during preparation', async () => {
  let revoked = false; fetchMock.mockImplementation(async () => { revoked = true; return new Response(JSON.stringify({ id: 'draft', conversationId: 'thread' })) }); const authorize = vi.fn(async () => { if (revoked) throw new AppError('FORBIDDEN', 'Access revoked', 403) }); await expect(deliverMicrosoftEmail({ ...input, authorize })).rejects.toMatchObject({ statusCode: 403 }); expect(fetchMock).toHaveBeenCalledOnce(); expect(String(fetchMock.mock.calls[0][0])).not.toContain('/send')
})
