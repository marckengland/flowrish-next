import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ account: vi.fn(), member: vi.fn(), permissions: vi.fn(), refresh: vi.fn(), decrypt: vi.fn(), fetch: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { emailAccount: { findFirst: mock.account }, organizationMember: { findUnique: mock.member } } }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: mock.permissions }))
vi.mock('@/server/services/email', () => ({ refreshTokenIfNeeded: mock.refresh }))
vi.mock('@/lib/encryption', () => ({ decrypt: mock.decrypt }))
import { fetchEmailConversation } from '../email-conversation'
const input = { accountId: 'mailbox', organizationId: 'org', userId: 'user', threadId: 'thread', sourceMessageId: 'source', leadEmails: ['lead@example.com', 'alt@example.com'] }
const encoded = (value: string) => Buffer.from(value).toString('base64url')
const gmail = (id: string, text: string, from = 'lead@example.com', to = 'owner@example.com', date = '2026-11-02T01:00:00Z') => ({ id, threadId: 'thread', internalDate: String(Date.parse(date)), payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: `Person <${from}>` }, { name: 'To', value: to }, { name: 'Subject', value: 'Proposal' }, { name: 'Message-ID', value: `<${id}@example.com>` }, { name: 'References', value: '<earlier@example.com>' }], body: { data: encoded(text), size: Buffer.byteLength(text) } } })
const graph = (id: string, text: string) => ({ id, conversationId: 'thread', subject: 'Proposal', receivedDateTime: '2026-11-02T01:00:00Z', from: { emailAddress: { address: 'lead@example.com' } }, toRecipients: [{ emailAddress: { address: 'owner@example.com' } }], body: { contentType: 'text', content: text }, internetMessageId: `<${id}@example.com>` })
const respond = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
describe('full email conversation retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.account.mockResolvedValue({ id: 'mailbox', organizationId: 'org', userId: 'user', provider: 'gmail', email: 'owner@example.com', accessToken: 'encrypted' })
    mock.member.mockResolvedValue({ userId: 'user' })
    mock.permissions.mockResolvedValue(new Set(['leads:read', 'leads:write']))
    mock.decrypt.mockReturnValue('synthetic-token')
    vi.stubGlobal('fetch', mock.fetch)
  })
  it('retrieves real MIME bodies in chronological order and binds alternate source sender', async () => {
    mock.fetch.mockResolvedValue(respond({ id: 'thread', messages: [gmail('source', 'Can we meet Tuesday?', 'alt@example.com', 'owner@example.com', '2026-11-02T02:00:00Z'), gmail('sent', 'Here is the proposal.', 'owner@example.com', 'lead@example.com')] }))
    const result = await fetchEmailConversation(input)
    expect(result).toMatchObject({ accountId: 'mailbox', provider: 'gmail', threadId: 'thread', recipientEmail: 'alt@example.com', mailboxEmail: 'owner@example.com' })
    expect(result.messages.map(m => m.id)).toEqual(['sent', 'source'])
    expect(result.messages.map(m => m.text)).toEqual(['Here is the proposal.', 'Can we meet Tuesday?'])
    expect(result.messages[1]).toMatchObject({ messageId: '<source@example.com>', references: '<earlier@example.com>' })
    expect(mock.refresh).toHaveBeenCalledWith('mailbox', 'org')
    expect(mock.account).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: 'mailbox', organizationId: 'org', userId: 'user' } }))
    expect(mock.fetch.mock.calls[0][0]).toBe('https://gmail.googleapis.com/gmail/v1/users/me/threads/thread?format=full')
  })
  it('prefers plain text alternatives and excludes file attachments', async () => {
    const message = gmail('source', '')
    Object.assign(message.payload, { mimeType: 'multipart/mixed', parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: encoded('<p>HTML duplicate</p>') } }, { mimeType: 'text/plain', body: { data: encoded('Actual plain text') } }] }, { mimeType: 'text/plain', filename: 'attachment.txt', body: { data: encoded('Private attachment') } }] })
    mock.fetch.mockResolvedValue(respond({ id: 'thread', messages: [message] }))
    expect((await fetchEmailConversation(input)).messages[0].text).toBe('Actual plain text')
    expect(mock.fetch).toHaveBeenCalledTimes(1)
  })
  it('converts HTML to plain text without script, style or external resource fetches', async () => {
    const message = gmail('source', '<style>.hidden{color:red}</style><script>doBad()</script><p>Hello &amp; thank you</p><img src="https://external.invalid/track"><p>Tuesday&#63;</p>')
    message.payload.mimeType = 'text/html'
    mock.fetch.mockResolvedValue(respond({ id: 'thread', messages: [message] }))
    const text = (await fetchEmailConversation(input)).messages[0].text
    expect(text).toBe('Hello & thank you\nTuesday?')
    expect(mock.fetch).toHaveBeenCalledTimes(1)
  })
  it('retrieves an inline text body stored through a Gmail attachment ID', async () => {
    const message = gmail('source', '')
    Object.assign(message.payload.body, { attachmentId: 'inline/body', data: undefined, size: 20 })
    mock.fetch.mockResolvedValueOnce(respond({ id: 'thread', messages: [message] })).mockResolvedValueOnce(respond({ data: encoded('Complete inline body') }))
    expect((await fetchEmailConversation(input)).messages[0].text).toBe('Complete inline body')
    expect(mock.fetch.mock.calls[1][0]).toContain('/messages/source/attachments/inline%2Fbody')
  })
  it('fails rather than substituting a preview when a text body is missing', async () => {
    const message = gmail('source', '')
    Object.assign(message.payload.body, { data: undefined, size: 24 })
    mock.fetch.mockResolvedValue(respond({ id: 'thread', messages: [message] }))
    await expect(fetchEmailConversation(input)).rejects.toThrow('complete email body')
  })
  it.each([
    ['different thread', { id: 'other', messages: [gmail('source', 'Hello')] }],
    ['source absent', { id: 'thread', messages: [gmail('other', 'Hello')] }],
    ['wrong source sender', { id: 'thread', messages: [gmail('source', 'Hello', 'stranger@example.com')] }],
    ['source addressed elsewhere', { id: 'thread', messages: [gmail('source', 'Hello', 'lead@example.com', 'stranger@example.com')] }],
  ])('rejects changed identity or participants: %s', async (_name, data) => {
    mock.fetch.mockResolvedValue(respond(data))
    await expect(fetchEmailConversation(input)).rejects.toThrow('conversation')
  })
  it('denies missing mailbox ownership or lead permission before provider access', async () => {
    mock.account.mockResolvedValueOnce(null)
    await expect(fetchEmailConversation(input)).rejects.toThrow('Mailbox')
    mock.permissions.mockResolvedValueOnce(new Set(['leads:read']))
    await expect(fetchEmailConversation(input)).rejects.toThrow('permission')
    expect(mock.fetch).not.toHaveBeenCalled()
    expect(mock.refresh).not.toHaveBeenCalled()
  })
  it('rejects missing membership and a mailbox disconnected during refresh', async () => {
    mock.member.mockResolvedValueOnce(null)
    await expect(fetchEmailConversation(input)).rejects.toThrow('member')
    mock.account.mockResolvedValueOnce({ id: 'mailbox', provider: 'gmail', email: 'owner@example.com' }).mockResolvedValueOnce(null)
    await expect(fetchEmailConversation(input)).rejects.toThrow('Mailbox')
    expect(mock.fetch).not.toHaveBeenCalled()
  })
  it('rejects more than 100 messages and text above the full-conversation budget', async () => {
    mock.fetch.mockResolvedValueOnce(respond({ id: 'thread', messages: Array.from({ length: 101 }, (_, index) => gmail(index === 0 ? 'source' : `message-${index}`, 'Hello')) }))
    await expect(fetchEmailConversation(input)).rejects.toThrow('too large')
    mock.fetch.mockResolvedValueOnce(respond({ id: 'thread', messages: [gmail('source', 'x'.repeat(100_001))] }))
    await expect(fetchEmailConversation(input)).rejects.toThrow('too large')
  })
  it('fingerprints actual ordered content, not previews or provider ordering', async () => {
    const first = gmail('sent', 'Proposal', 'owner@example.com', 'lead@example.com')
    const last = gmail('source', 'Tuesday?', 'lead@example.com', 'owner@example.com', '2026-11-02T02:00:00Z')
    mock.fetch.mockResolvedValueOnce(respond({ id: 'thread', messages: [first, last] })).mockResolvedValueOnce(respond({ id: 'thread', messages: [last, first] })).mockResolvedValueOnce(respond({ id: 'thread', messages: [first, { ...last, payload: { ...last.payload, body: { data: encoded('Wednesday?') } } }] }))
    const one = await fetchEmailConversation(input)
    const two = await fetchEmailConversation(input)
    const changed = await fetchEmailConversation(input)
    expect(one.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(two.fingerprint).toBe(one.fingerprint)
    expect(changed.fingerprint).not.toBe(one.fingerprint)
  })
  it('retrieves all Graph body pages and requests text bodies', async () => {
    mock.account.mockResolvedValue({ id: 'mailbox', organizationId: 'org', userId: 'user', provider: 'microsoft', email: 'owner@example.com', accessToken: 'encrypted' })
    mock.fetch.mockResolvedValueOnce(respond({ value: [graph('prior', 'First body')], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=next' })).mockResolvedValueOnce(respond({ value: [graph('source', 'Full reply body')] }))
    const result = await fetchEmailConversation(input)
    expect(result.messages.map(m => m.text)).toEqual(['First body', 'Full reply body'])
    expect(mock.fetch.mock.calls[0][1].headers.Prefer).toBe('outlook.body-content-type="text"')
    expect(mock.fetch.mock.calls[0][0]).toContain('body')
  })
  it.each(['https://evil.invalid/mail', 'http://graph.microsoft.com/v1.0/me/messages', 'https://user:password@graph.microsoft.com/v1.0/me/messages', 'https://graph.microsoft.com/v1.0/users/other/messages'])('rejects unsafe Graph continuation %s', async next => {
    mock.account.mockResolvedValue({ id: 'mailbox', provider: 'microsoft', email: 'owner@example.com', accessToken: 'encrypted' })
    mock.fetch.mockResolvedValueOnce(respond({ value: [graph('source', 'Full body')], '@odata.nextLink': next }))
    await expect(fetchEmailConversation(input)).rejects.toThrow('continuation')
    expect(mock.fetch).toHaveBeenCalledTimes(1)
  })
  it('fails safely on a provider error without echoing its response body or token', async () => {
    mock.fetch.mockResolvedValueOnce(new Response('secret-provider-body synthetic-token', { status: 401 }))
    const failure = await fetchEmailConversation(input).catch(error => error)
    expect(failure.message).toContain('Reconnect')
    expect(failure.message).not.toContain('secret-provider-body')
    expect(failure.message).not.toContain('synthetic-token')
  })

it('includes legitimate copied coworkers in the verified owned conversation', async () => {
  mock.account.mockResolvedValue({ id: 'mailbox', organizationId: 'org', userId: 'user', provider: 'gmail', email: 'owner@example.com', accessToken: 'encrypted' })
  mock.member.mockResolvedValue({ userId: 'user' })
  mock.permissions.mockResolvedValue(new Set(['leads:read', 'leads:write']))
  mock.decrypt.mockReturnValue('synthetic-token')
  vi.stubGlobal('fetch', mock.fetch)
  const coworker = gmail('coworker', 'I will join the meeting.', 'coworker@example.com', 'lead@example.com')
  coworker.payload.headers.push({ name: 'Cc', value: 'owner@example.com' })
  mock.fetch.mockResolvedValueOnce(respond({ id: 'thread', messages: [gmail('source', 'Tuesday works.'), coworker] }))
  const conversation = await fetchEmailConversation(input)
  expect(conversation.messages.map(message => message.text)).toContain('I will join the meeting.')
  expect(conversation.messages.find(message => message.id === 'coworker')?.toEmails).toEqual(['lead@example.com', 'owner@example.com'])
})

it('rejects an unsupported provider without refreshing or requesting it', async () => {
  vi.clearAllMocks()
  mock.account.mockResolvedValue({ id: 'mailbox', provider: 'unknown', email: 'owner@example.com', accessToken: 'encrypted' })
  mock.member.mockResolvedValue({ userId: 'user' })
  mock.permissions.mockResolvedValue(new Set(['leads:read', 'leads:write']))
  await expect(fetchEmailConversation(input)).rejects.toThrow('provider')
  expect(mock.refresh).not.toHaveBeenCalled()
  expect(mock.fetch).not.toHaveBeenCalled()
})

it('does not silently accept an inline body response without its data', async () => {
  const message = gmail('source', '')
  Object.assign(message.payload.body, { attachmentId: 'inline', data: undefined, size: 0 })
  mock.fetch.mockResolvedValueOnce(respond({ id: 'thread', messages: [message] })).mockResolvedValueOnce(respond({}))
  await expect(fetchEmailConversation(input)).rejects.toThrow('complete email body')
})

it('unfolds reference headers before returning values that can become reply headers', async () => {
  const message = gmail('source', 'Tuesday?')
  message.payload.headers.find(value => value.name === 'References')!.value = '<first@example.com>\r\n <second@example.com>'
  mock.fetch.mockResolvedValueOnce(respond({ id: 'thread', messages: [message] }))
  const conversation = await fetchEmailConversation(input)
  expect(conversation.messages[0].references).toBe('<first@example.com> <second@example.com>')
})
})

describe('conversation refresh deadline', () => {
  it('bounds a hung legacy token refresh before any conversation request', async () => {
    vi.useFakeTimers()
    try {
      vi.clearAllMocks()
      mock.account.mockResolvedValue({ id: 'mailbox', provider: 'gmail', email: 'owner@example.com', accessToken: 'encrypted' })
      mock.member.mockResolvedValue({ userId: 'user' })
      mock.permissions.mockResolvedValue(new Set(['leads:read', 'leads:write']))
      mock.refresh.mockImplementationOnce(() => new Promise(() => {}))
      let failure: Error | undefined
      void fetchEmailConversation(input).catch(error => { failure = error })
      await vi.advanceTimersByTimeAsync(15_000)
      expect(failure?.message).toContain('timed out')
      expect(mock.fetch).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
