import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: vi.fn() }))
vi.mock('@/lib/encryption', () => ({ encrypt: vi.fn() }))
import { listMicrosoftMessages } from '../microsoft-email'
const fetchMock = vi.fn()
const row = (id: string) => ({ id, conversationId: 'thread', receivedDateTime: '2026-11-02T00:00:00Z', from: { emailAddress: { address: 'LEAD@example.com' } }, toRecipients: [{ emailAddress: { address: 'REP@example.com' } }] })
const response = (body: unknown) => ({ ok: true, json: async () => body })
describe('Microsoft sync pagination', () => {
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
  it('includes later pages and preserves normalized recipients and thread identity', async () => {
    fetchMock.mockResolvedValueOnce(response({ value: [row('first')], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=second' })).mockResolvedValueOnce(response({ value: [row('second')] }))
    const messages = await listMicrosoftMessages('test-token', '2026-11-01T00:00:00Z')
    expect(messages.map(m => m.externalId)).toEqual(['first', 'second'])
    expect(messages[1]).toMatchObject({ threadId: 'thread', fromEmail: 'lead@example.com', recipientEmails: ['rep@example.com'] })
  })
  it.each(['https://evil.invalid/v1.0/me/messages', 'http://graph.microsoft.com/v1.0/me/messages', 'https://user:password@graph.microsoft.com/v1.0/me/messages', 'https://graph.microsoft.com/v1.0/users/other/messages'])('rejects unsafe continuation URLs: %s', async next => {
    fetchMock.mockResolvedValue(response({ value: [row('first')], '@odata.nextLink': next }))
    await expect(listMicrosoftMessages('test-token', '2026-11-01T00:00:00Z')).rejects.toThrow('Invalid Microsoft mailbox continuation')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('fails visibly at the page cap instead of returning a truncated success', async () => {
    fetchMock.mockImplementation(async () => response({ value: [row('first')], '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/messages?$skiptoken=${fetchMock.mock.calls.length}` }))
    await expect(listMicrosoftMessages('test-token', '2026-11-01T00:00:00Z')).rejects.toThrow('Mailbox sync page limit reached')
    expect(fetchMock).toHaveBeenCalledTimes(100)
  })
  it('does not expose provider error body or credentials on failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'secret-provider-body test-token' })
    await expect(listMicrosoftMessages('test-token', '2026-11-01T00:00:00Z')).rejects.toThrow('Microsoft mailbox request failed (401)')
  })
})
