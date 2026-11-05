import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FollowUpBulkApproval } from './follow-up-bulk-approval'
const context = { organizationId: 'org', userId: 'actor' }, version = 'a'.repeat(64), row = { id: 'item', status: 'PENDING', sourceType: 'EMAIL' as const, taskId: null, title: 'Call clinic', snoozeVersion: version, lead: { firstName: 'Practice', lastName: 'Clinic' } }
const snapshot = { id: row.id, version, sourceType: 'EMAIL', assigneeId: 'actor', title: row.title, description: 'Notes', existingTask: null, leadName: 'Practice Clinic' }
const changed = vi.fn(), selection = vi.fn(), lost = vi.fn(), busy = vi.fn(), fetcher = vi.fn()
const props = { items: [row], selectedIds: ['item'], blockedIds: [] as string[], context, disabled: false, otherBusy: false, refreshing: false, onSelectionChange: selection, onChanged: changed, onAccessLost: lost, onBusyChange: busy }
const reply = (data: unknown) => new Response(JSON.stringify({ data, scope: context, capabilities: { canWrite: true } }))
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', fetcher); fetcher.mockResolvedValue(reply(snapshot)) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function review() { fireEvent.click(screen.getByRole('button', { name: 'Review task approvals' })); await screen.findByRole('button', { name: 'Confirm bulk approval' }) }
it('reviews with GET only, edits task fields, then explicitly confirms without sending mail', async () => {
 render(<FollowUpBulkApproval {...props} />); expect(fetcher).not.toHaveBeenCalled(); await review(); expect(fetcher.mock.calls[0][1].method).toBe('GET'); expect(changed).not.toHaveBeenCalled()
 fireEvent.change(screen.getByLabelText('Approval task title for Practice Clinic'), { target: { value: 'Reviewed callback' } }); fireEvent.change(screen.getByLabelText('Approval due date for Practice Clinic'), { target: { value: '2026-11-09' } })
 fetcher.mockImplementationOnce(async (_url: string, init: RequestInit) => { const input = JSON.parse(init.body as string); return reply({ id: 'item', requestId: input.requestId, state: 'confirmed', task: { id: 'task', assigneeId: 'actor', title: input.title, description: input.description, dueDate: input.dueDate } }) })
 fireEvent.click(screen.getByRole('button', { name: 'Confirm bulk approval' })); await screen.findByText('1 of 1 task approvals confirmed or verified.'); expect(changed).toHaveBeenCalledOnce(); expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ title: 'Reviewed callback', assigneeId: 'actor', dueDate: '2026-11-09T00:00:00.000Z' }); expect(fetcher).toHaveBeenCalledTimes(2)
})
it('blocks dirty card edits and another active operation without replacing the selection', async () => {
 const ui = render(<FollowUpBulkApproval {...props} blockedIds={['item']} />); expect(screen.getByRole('button', { name: 'Review task approvals' })).toBeDisabled(); expect(screen.getByText(/Resolve card edits/)).toBeInTheDocument(); ui.rerender(<FollowUpBulkApproval {...props} otherBusy />); expect(screen.getByRole('button', { name: 'Review task approvals' })).toBeDisabled(); expect(fetcher).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled()
})
it('requires a new review when selected source versions change', async () => {
 const ui = render(<FollowUpBulkApproval {...props} />); await review(); ui.rerender(<FollowUpBulkApproval {...props} items={[{ ...row, snoozeVersion: 'b'.repeat(64) }]} />); expect(screen.getByRole('button', { name: 'Confirm bulk approval' })).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent('Selected follow-ups changed'); expect(fetcher).toHaveBeenCalledTimes(1)
})
it('keeps uncertain request values and checks results with GET without another approval', async () => {
 render(<FollowUpBulkApproval {...props} />); await review(); fetcher.mockRejectedValueOnce(new Error('lost')); fireEvent.click(screen.getByRole('button', { name: 'Confirm bulk approval' })); await screen.findByRole('button', { name: 'Check approval results' }); const input = JSON.parse(fetcher.mock.calls[1][1].body)
 fetcher.mockResolvedValueOnce(reply({ id: 'item', requestId: input.requestId, state: 'confirmed', task: { id: 'task', assigneeId: 'actor', title: input.title, description: input.description, dueDate: input.dueDate } })); fireEvent.click(screen.getByRole('button', { name: 'Check approval results' })); await screen.findByText('1 of 1 task approvals confirmed or verified.'); expect(fetcher).toHaveBeenCalledTimes(3); expect(fetcher.mock.calls[2][1].method).toBe('GET'); expect(changed).toHaveBeenCalledOnce(); await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false))
})
