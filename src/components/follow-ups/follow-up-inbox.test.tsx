import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FollowUpInbox } from './follow-up-inbox'

vi.mock('@/components/email/email-compose', () => ({
  EmailCompose: ({ defaultBody, defaultSubject }: { defaultBody: string; defaultSubject: string }) => <section aria-label="Email composer"><span>{defaultSubject}</span><output>{defaultBody}</output><button>Send email</button></section>,
}))
const item = {
  id: 'suggestion-1', sourceType: 'EMAIL', sourceText: 'Could you send the pricing?',
  title: 'Follow up with Jane', description: 'Discuss pricing', draftSubject: 'Re: Pricing',
  draftBody: '<script>alert(1)</script>\nThanks, Jane & team.', status: 'PENDING', taskId: null,
  lead: { id: 'lead-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }, createdAt: '2026-11-02T03:00:00.000Z',
}
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) } as Response)
beforeEach(() => vi.restoreAllMocks())

describe('FollowUpInbox', () => {
  it('shows the source preview without creating a task or sending a message', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([item]))
    render(<FollowUpInbox canWrite />)
    expect(await screen.findByText('Could you send the pricing?')).toBeInTheDocument()
    expect(screen.getByText('Email preview')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Jane Doe' })).toHaveAttribute('href', '/leads/lead-1')
    expect(request.mock.calls).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Email composer' })).not.toBeInTheDocument()
  })

  it('approves the edited task and shows its resulting link without sending email', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok([item])).mockResolvedValueOnce(ok({ ...item, status: 'APPROVED', taskId: 'task-1' }))
    render(<FollowUpInbox canWrite />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review follow-up' })); fireEvent.change(await screen.findByLabelText('Task title'), { target: { value: 'Call Jane about pricing' } })
    fireEvent.change(screen.getByLabelText('Task description'), { target: { value: 'Confirm team size' } })
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-11-04' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve task' }))
    expect(await screen.findByRole('link', { name: 'Open task' })).toHaveAttribute('href', '/tasks/task-1')
    expect(request.mock.calls[1][0]).toBe('/api/follow-ups/suggestion-1')
    expect(JSON.parse(request.mock.calls[1][1]?.body as string)).toMatchObject({ action: 'approve', title: 'Call Jane about pricing', description: 'Confirm team size', dueDate: '2026-11-04T00:00:00.000Z' })
    expect(request.mock.calls).toHaveLength(2)
  })

  it('dismisses without approving a task', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok([item])).mockResolvedValueOnce(ok({ ...item, status: 'DISMISSED' }))
    render(<FollowUpInbox canWrite />)
fireEvent.click(await screen.findByRole('button', { name: 'Review follow-up' }));     fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Follow-up dismissed')
    expect(JSON.parse(request.mock.calls[1][1]?.body as string)).toEqual({ action: 'dismiss' })
  })

  it('retains edits and permits retry after failed approval', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok([item])).mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Lead is unavailable' } }) } as Response)
    render(<FollowUpInbox canWrite />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review follow-up' })); fireEvent.change(await screen.findByLabelText('Task title'), { target: { value: 'Keep my edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve task' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Lead is unavailable')
    expect(screen.getByLabelText('Task title')).toHaveValue('Keep my edit')
    expect(screen.getByRole('button', { name: 'Approve task' })).toBeEnabled()
  })

  it('opens an escaped draft for explicit review without making a send request', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([item]))
    render(<FollowUpInbox canWrite />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review email draft' }))
    expect(screen.getByRole('region', { name: 'Email composer' })).toHaveTextContent('&lt;script&gt;alert(1)&lt;/script&gt;<br />Thanks, Jane &amp; team.')
    expect(request.mock.calls).toHaveLength(1)
  })

  it('renders a linked callback without offering to create another task', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([{ ...item, sourceType: 'CALL', taskId: 'callback-1', draftBody: null, draftSubject: null }]))
    render(<FollowUpInbox canWrite />)
    expect(await screen.findByText('Call summary')).toBeInTheDocument()
fireEvent.click(await screen.findByRole('button', { name: 'Review follow-up' }));     expect(screen.getByRole('button', { name: 'Mark reviewed' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open task' })).toHaveAttribute('href', '/tasks/callback-1')
    expect(screen.queryByRole('button', { name: 'Approve task' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review email draft' })).not.toBeInTheDocument()
  })

  it('loads history when the selected tab changes', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([{ ...item, status: 'APPROVED', taskId: 'task-2' }]))
    render(<FollowUpInbox canWrite />)
    await screen.findByText('No pending follow-ups')
    fireEvent.click(screen.getByRole('tab', { name: 'Approved' }))
    expect(await screen.findByRole('link', { name: 'Open task' })).toHaveAttribute('href', '/tasks/task-2')
    expect(request.mock.calls[1][0]).toBe('/api/follow-ups?status=APPROVED')
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  })

  it('supports keyboard navigation between status tabs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([]))
    render(<FollowUpInbox canWrite />)
    await screen.findByText('No pending follow-ups')
    const pending = screen.getByRole('tab', { name: 'Pending' })
    pending.focus()
    fireEvent.keyDown(pending, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Approved' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Approved' })).toHaveAttribute('aria-selected', 'true')
    await screen.findByText('No approved follow-ups')
  })

  it('closes an open draft after dismissing its follow-up', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok([item])).mockResolvedValueOnce(ok({ ...item, status: 'DISMISSED' }))
    render(<FollowUpInbox canWrite />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review email draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await screen.findByText('Follow-up dismissed.')
    expect(screen.queryByRole('region', { name: 'Email composer' })).not.toBeInTheDocument()
  })

  it('allows retry after a failed load', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(ok([]))
    render(<FollowUpInbox canWrite />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No pending follow-ups')).toBeInTheDocument()
  })

  it('shows a loading state until the request resolves', async () => {
    let resolve!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>((done) => { resolve = done }))
    render(<FollowUpInbox canWrite />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading follow-ups')
    resolve(ok([]))
    await waitFor(() => expect(screen.getByText('No pending follow-ups')).toBeInTheDocument())
  })

  it('keeps a read-only inbox free of mutation and send controls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([item]))
    render(<FollowUpInbox canWrite={false} />)
    await screen.findByText('Could you send the pricing?')
    expect(screen.queryByRole('button', { name: 'Approve task' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review email draft' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument()
  })
})
