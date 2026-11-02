import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EmailCompose } from './email-compose'
vi.mock('@/components/email/rich-text-editor', () => ({ RichTextEditor: ({ defaultValue, onChange, onFilesDropped }: any) => <><textarea aria-label="Email body" defaultValue={defaultValue} onChange={event => onChange(event.target.value)} /><button type="button" onClick={() => onFilesDropped([new File(['test'], 'note.txt', { type: 'text/plain' })])}>Add fixture file</button></> }))
vi.mock('@/components/ai/email-generator', () => ({ EmailGenerator: () => <div>Generic AI helper</div> }))
const props = { leadId: 'lead', leadName: 'Jane', leadEmail: 'alternate@example.com', defaultSubject: 'Re: Pricing', defaultBody: 'Reviewed reply', replyToThreadId: 'thread', followUpId: 'follow-up', draftVersion: 'version' }
beforeEach(() => vi.restoreAllMocks())
describe('context-bound email composer', () => {
  it('preserves a source reply subject without adding a second prefix', () => {
    render(<EmailCompose {...props} defaultSubject="Re:Pricing" />)
    expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue('Re:Pricing')
  })
  it('labels each subject independently when multiple drafts are open', () => {
    render(<><EmailCompose {...props} /><EmailCompose {...props} defaultSubject="Re: Other conversation" /></>)
    const subjects = screen.getAllByRole('textbox', { name: 'Subject' })
    expect(subjects).toHaveLength(2)
    expect(subjects[0].id).not.toBe(subjects[1].id)
  })
  it.each([false, true])('submits version identity only after explicit Send (attachments=%s)', async (withAttachments) => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: { messageId: 'message', threadId: 'thread', attachmentCount: withAttachments ? 1 : 0 } }) } as Response)
    render(<EmailCompose {...props} />)
    expect(screen.queryByText('Generic AI helper')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send test email' })).not.toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Email body'), { target: { value: 'My edited reply' } })
    if (withAttachments) fireEvent.click(screen.getByRole('button', { name: 'Add fixture file' }))
    fireEvent.submit(screen.getByRole('form', { name: 'Reply email' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    const body = request.mock.calls[0][1]?.body
    const payload = typeof body === 'string' ? JSON.parse(body) : JSON.parse((body as FormData).get('payload') as string)
    expect(payload).toMatchObject({ followUpId: 'follow-up', draftVersion: 'version', threadId: 'thread', body: 'My edited reply' })
  })
})
