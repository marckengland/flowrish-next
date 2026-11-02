import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/env', () => ({ env: {} }))
import { deliverMicrosoftEmail } from '../microsoft-email'
const request = vi.fn()
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', request) })
describe('strict source-bound Outlook reply', () => {
  it('binds reply draft to the reviewed recipient and subject before sending', async () => {
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ value: [{ id: 'latest' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'draft', conversationId: 'source-thread' }) })
      .mockResolvedValue({ ok: true, json: async () => ({}) })
    await deliverMicrosoftEmail({ accessToken: 'synthetic', to: 'alternate@example.invalid', subject: 'Reviewed subject', htmlBody: '<p>Reviewed body</p>', attachments: [], replyToConversationId: 'source-thread', strictReply: true })
    const patches = request.mock.calls.filter(([, options]) => options.method === 'PATCH').map(([, options]) => JSON.parse(options.body))
    expect(patches).toContainEqual(expect.objectContaining({ toRecipients: [{ emailAddress: { address: 'alternate@example.invalid' } }], subject: 'Reviewed subject' }))
    expect(request.mock.calls.at(-1)![0]).toContain('/draft/send')
  })
  it('fails closed if the original conversation is gone instead of starting a new message', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ value: [] }) })
    await expect(deliverMicrosoftEmail({ accessToken: 'synthetic', to: 'alternate@example.invalid', subject: 'Subject', htmlBody: '<p>Body</p>', attachments: [], replyToConversationId: 'missing', strictReply: true })).rejects.toMatchObject({ statusCode: 409 })
    expect(request.mock.calls.some(([,options]) => options.method === 'POST')).toBe(false)
  })
})
