import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FollowUpInbox } from './follow-up-inbox'

const composer = vi.hoisted(() => vi.fn())
vi.mock('@/components/email/email-compose', () => ({ EmailCompose: (props: any) => { composer(props); return <textarea aria-label="Draft body" defaultValue={props.defaultBody} /> } }))
const item = { id: 'follow-up', sourceType: 'EMAIL', sourceText: 'Pricing?', title: 'Call Jane', description: 'Ask about pricing', draftSubject: 'Re: Pricing', draftBody: 'Template', status: 'PENDING', taskId: null, lead: { id: 'lead', firstName: 'Jane', lastName: 'Doe', email: 'primary@example.com' }, createdAt: '2026-11-02T00:00:00Z' }
const generated = { id: item.id, subject: 'Pricing details', body: 'Hi <Jane> & team', generatedAt: '2026-11-02T01:00:00Z', version: 'version-1', context: { accountId: 'account', provider: 'gmail', threadId: 'thread', recipientEmail: 'alternate@example.com', mailboxEmail: 'rep@example.com', messageCount: 3, lastMessageAt: '2026-11-02T00:00:00Z' } }
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) } as Response)
beforeEach(() => { vi.restoreAllMocks(); composer.mockClear() })
describe('conversation follow-up drafts', () => {
  it('generates only on request, displays provenance and binds the reviewed reply to its version', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok([item])).mockResolvedValueOnce(ok(generated))
    render(<FollowUpInbox canWrite />)
    fireEvent.change(await screen.findByLabelText('Draft instructions'), { target: { value: 'Keep it brief' } })
    expect(request).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Generate contextual draft' }))
    await screen.findByText(/3 messages/)
    expect(JSON.parse(request.mock.calls[1][1]?.body as string)).toEqual({ instructions: 'Keep it brief' })
    expect(screen.getByText(/alternate@example.com/)).toBeInTheDocument()
    expect(composer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Review email draft' }))
    expect(composer).toHaveBeenLastCalledWith(expect.objectContaining({ followUpId: item.id, draftVersion: 'version-1', replyToThreadId: 'thread', leadEmail: 'alternate@example.com', defaultBody: 'Hi &lt;Jane&gt; &amp; team' }))
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('requires an explicit discard choice before regenerating an open composer and preserves it on failure', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok([{ ...item, draftVersion: generated.version, draftGeneratedAt: generated.generatedAt, draftContext: generated.context, draftBody: generated.body }])).mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Try again later' } }) } as Response)
    render(<FollowUpInbox canWrite />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review email draft' }))
    fireEvent.change(screen.getByLabelText('Draft body'), { target: { value: 'My edited draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate contextual draft' }))
    expect(request).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Replace open draft' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later')
    expect(screen.getByLabelText('Draft body')).toHaveValue('My edited draft')
  })
  it('does not reopen a draft when generation finishes after dismissal', async () => {
    let resolve!: (response: Response) => void
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok([item])).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done })).mockResolvedValueOnce(ok({ ...item, status: 'DISMISSED' }))
    render(<FollowUpInbox canWrite />)
    fireEvent.click(await screen.findByRole('button', { name: 'Generate contextual draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await screen.findByText('Follow-up dismissed.')
    await act(async () => resolve(ok(generated)))
    expect(screen.queryByRole('button', { name: 'Review email draft' })).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(3)
  })
  it('offers no contextual generation for calls or read-only users', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([{ ...item, sourceType: 'CALL' }]))
    render(<FollowUpInbox canWrite={false} />)
    await screen.findByText('Call summary')
    expect(screen.queryByLabelText('Draft instructions')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate contextual draft' })).not.toBeInTheDocument()
  })
})

describe('open draft navigation protection', () => {
  it.each(['Refresh', 'Approved'])('keeps editor edits until explicit discard before %s', async (action) => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok([item])).mockResolvedValueOnce(ok([]))
    render(<FollowUpInbox canWrite />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review email draft' }))
    fireEvent.change(screen.getByLabelText('Draft body'), { target: { value: 'My unsent edits' } })
    const navigate = () => fireEvent.click(screen.getByRole(action === 'Refresh' ? 'button' : 'tab', { name: action }))
    navigate()
    expect(request).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Draft body')).toHaveValue('My unsent edits')
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Draft body')).toHaveValue('My unsent edits')
    navigate()
    fireEvent.click(screen.getByRole('button', { name: action === 'Refresh' ? 'Discard and refresh' : 'Discard and change tab' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(screen.queryByLabelText('Draft body')).not.toBeInTheDocument()
    expect(request.mock.calls[1][0]).toBe(`/api/follow-ups?status=${action === 'Refresh' ? 'PENDING' : 'APPROVED'}`)
  })
})
