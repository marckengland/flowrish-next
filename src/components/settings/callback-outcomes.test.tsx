import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CallbackOutcomeTracker, CallbackOutcomeQueue } from './callback-outcomes'
import { TaskDetailView } from '@/components/tasks/task-detail'
import type { TaskItem } from '@/hooks/use-tasks'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { taskQueryRoot } from '@/lib/task-query-root'
const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/hooks/use-tasks', () => ({ useCompleteTaskMutation: () => ({ isPending: false, variables: null, error: null }) }))
const callbackId = '11111111-1111-4111-8111-111111111111', taskId = '22222222-2222-4222-8222-222222222222', owner = '33333333-3333-4333-8333-333333333333'
const detail = { callbackId, taskId, version: 'a'.repeat(64), source: null, closed: false, canEdit: true, leadAvailable: true, task: { id: taskId, title: 'Callback: Jamie', dueDate: '2030-01-01T00:00:00.000Z', assigneeId: owner, assigneeName: 'Owner', isComplete: false }, members: [{ id: owner, label: 'Owner' }], membersTruncated: false, history: [], hasMore: false, beforeNext: null }
const fetch = vi.fn()
beforeEach(() => { refresh.mockReset(); fetch.mockReset(); vi.stubGlobal('fetch', fetch) })
function response(data: unknown, status = 200) { return { ok: status === 200, status, json: async () => ({ data }) } }
async function load() { render(<CallbackOutcomeTracker callbackId={callbackId} />); expect(fetch).not.toHaveBeenCalled(); fetch.mockResolvedValueOnce(response(detail)); fireEvent.click(screen.getByRole('button', { name: 'Track callback outcome' })); await screen.findByRole('combobox', { name: 'Callback result' }); fireEvent.change(screen.getByRole('combobox', { name: 'Callback result' }), { target: { value: 'reached' } }) }
function previewResponse() { fetch.mockImplementationOnce(async (_path, init) => { const body = JSON.parse(init.body); return response({ ...body, callbackId, version: 'b'.repeat(64), taskTitle: 'Callback: Jamie', taskChange: 'Complete existing task', sourceChange: 'Keep source history', nextOwner: null, nextDueDate: null, reopensTask: false }) }) }
describe('staff-reported callback outcomes', () => {
  it('requires review and approval and invalidates them when entries change', async () => {
    await load(); previewResponse(); fireEvent.click(screen.getByRole('button', { name: 'Preview outcome' })); const approve = await screen.findByRole('checkbox', { name: /I approve recording/ }); expect(screen.getByRole('button', { name: 'Confirm callback outcome' })).toBeDisabled(); fireEvent.click(approve); fireEvent.change(screen.getByRole('textbox', { name: 'Outcome notes' }), { target: { value: 'Changed notes' } }); expect(screen.queryByRole('button', { name: 'Confirm callback outcome' })).toBeNull(); expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('keeps one request ID across ambiguous retries and accepts only matching acknowledgements', async () => {
    await load(); previewResponse(); fireEvent.click(screen.getByRole('button', { name: 'Preview outcome' })); fireEvent.click(await screen.findByRole('checkbox', { name: /I approve recording/ })); fetch.mockRejectedValueOnce(new Error('Lost response')); fireEvent.click(screen.getByRole('button', { name: 'Confirm callback outcome' })); await screen.findByRole('alert')
    const first = JSON.parse(fetch.mock.calls[2][1].body)
    fetch.mockResolvedValueOnce(response({ recorded: true, callbackId, requestId: first.requestId, action: 'record' })); fetch.mockResolvedValueOnce(response(detail)); fireEvent.click(screen.getByRole('button', { name: 'Confirm callback outcome' })); await screen.findByText('Callback outcome recorded.'); expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual(first); expect(first.confirmed).toBe(true)
  })
  it('preserves notes on conflicts and never renders server diagnostics', async () => {
    await load(); fireEvent.change(screen.getByRole('textbox', { name: 'Outcome notes' }), { target: { value: '<img src=x onerror=alert(1)>' } }); fetch.mockResolvedValueOnce(response({ message: 'SQL private diagnostic' }, 409)); fireEvent.click(screen.getByRole('button', { name: 'Preview outcome' })); await screen.findByRole('alert'); expect(screen.getByRole('textbox', { name: 'Outcome notes' })).toHaveValue('<img src=x onerror=alert(1)>'); expect(document.querySelector('img')).toBeNull(); expect(screen.queryByText('SQL private diagnostic')).toBeNull()
  })
  it('rejects mismatched details and preview drafts', async () => {
    render(<CallbackOutcomeTracker taskId={taskId} />); fetch.mockResolvedValueOnce(response({ ...detail, taskId: owner })); fireEvent.click(screen.getByRole('button', { name: 'Track callback outcome' })); await screen.findByRole('alert'); expect(screen.queryByRole('combobox', { name: 'Callback result' })).toBeNull()
  })
  it('does not offer edits after closure and renders history as plain text', async () => {
    fetch.mockResolvedValueOnce(response({ ...detail, closed: true, canEdit: false, history: [{ id: owner, sequence: 1, outcome: 'reached', action: 'close', notes: '<img src=x>', createdAt: '2026-11-03T00:00:00.000Z', createdByName: 'Owner', assigneeName: null, dueDate: null }] })); render(<CallbackOutcomeTracker callbackId={callbackId} />); fireEvent.click(screen.getByRole('button', { name: 'Track callback outcome' })); await screen.findByText('Request closed'); expect(screen.queryByRole('button', { name: 'Preview outcome' })).toBeNull(); expect(document.querySelector('img')).toBeNull()
  })
  it('allows the task detail flow to close its assigned callback through the task alias and refresh CRM state', async () => {
    const task: TaskItem = { id: taskId, leadId: owner, assigneeId: owner, organizationId: owner, title: 'Callback: Jamie', description: 'Source callback: original', priority: 'MEDIUM', dueDate: '2030-01-01T00:00:00.000Z', completedAt: null, isComplete: false, isOverdue: false, createdAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z' }
    render(<TaskDetailView task={task} canComplete={false} canReassign={false} />); expect(fetch).not.toHaveBeenCalled(); fetch.mockResolvedValueOnce(response(detail)); fireEvent.click(screen.getByRole('button', { name: 'Track callback outcome' })); await screen.findByRole('combobox', { name: 'Callback result' }); expect(fetch.mock.calls[0][0]).toBe(`/api/tasks/${taskId}/callback-outcomes`)
    fireEvent.change(screen.getByRole('combobox', { name: 'Callback result' }), { target: { value: 'reached' } }); fireEvent.change(screen.getByRole('combobox', { name: 'Next action' }), { target: { value: 'close' } }); previewResponse(); fireEvent.click(screen.getByRole('button', { name: 'Preview outcome' })); fireEvent.click(await screen.findByRole('checkbox', { name: /I approve recording/ }))
    fetch.mockImplementationOnce(async (_path, init) => response({ recorded: true, callbackId, requestId: JSON.parse(init.body).requestId, action: 'close' })); fetch.mockResolvedValueOnce(response({ ...detail, closed: true, canEdit: false, task: { ...detail.task, isComplete: true } })); fireEvent.click(screen.getByRole('button', { name: 'Confirm callback outcome' })); await screen.findByText('Callback closed and task completed.'); expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('preserves successful reassignment evidence when follow-up access is lost and invalidates cached task lists', async () => {
    const queryClient = new QueryClient(); queryClient.setQueryData([...taskQueryRoot, 'list', {}], [{ id: taskId }])
    render(<QueryClientProvider client={queryClient}><CallbackOutcomeTracker callbackId={callbackId} /></QueryClientProvider>); fetch.mockResolvedValueOnce(response({ ...detail, members: [...detail.members, { id: taskId, label: 'Another owner' }] })); fireEvent.click(screen.getByRole('button', { name: 'Track callback outcome' })); await screen.findByRole('combobox', { name: 'Callback result' }); fireEvent.change(screen.getByRole('combobox', { name: 'Callback result' }), { target: { value: 'retry' } }); fireEvent.change(screen.getByRole('combobox', { name: 'Next action' }), { target: { value: 'reschedule' } }); fireEvent.change(screen.getByRole('combobox', { name: 'Next callback owner' }), { target: { value: taskId } }); fireEvent.change(screen.getByLabelText('Next callback deadline'), { target: { value: '2030-01-01T10:00' } }); previewResponse(); fireEvent.click(screen.getByRole('button', { name: 'Preview outcome' })); fireEvent.click(await screen.findByRole('checkbox', { name: /I approve recording/ }))
    fetch.mockImplementationOnce(async (_path, init) => response({ recorded: true, callbackId, requestId: JSON.parse(init.body).requestId, action: 'reschedule' })); fetch.mockResolvedValueOnce(response({}, 403)); fireEvent.click(screen.getByRole('button', { name: 'Confirm callback outcome' })); await screen.findByText('Callback rescheduled.'); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Outcome saved.')); expect(screen.getByRole('alert')).not.toHaveTextContent('Could not confirm'); expect(queryClient.getQueryState([...taskQueryRoot, 'list', {}])?.isInvalidated).toBe(true); expect(screen.queryByRole('combobox', { name: 'Callback result' })).toBeNull(); queryClient.clear()
  })
  it('loads overdue work only explicitly and preserves server page identity', async () => {
    render(<CallbackOutcomeQueue />); expect(fetch).not.toHaveBeenCalled(); fetch.mockResolvedValueOnce(response({ rows: [], page: 1, hasMore: false })); fireEvent.click(screen.getByRole('button', { name: 'Load callback work queue' })); await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/callback-outcomes?filter=overdue&page=1', expect.anything())); await screen.findByText('No callback work in this view.')
  })
})
