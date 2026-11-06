import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FollowUpTaskCompletion } from './follow-up-task-completion'
import { FollowUpInbox } from './follow-up-inbox'
vi.mock('./email-match-inbox', () => ({ EmailMatchInbox: () => null }))
vi.mock('@/components/email/email-compose', () => ({ EmailCompose: () => <label>Unsent completion subject<input defaultValue="Keep this draft" /></label> }))
const context = { organizationId: 'org', userId: 'actor' }, stamp = '2026-11-06T01:00:00.000Z'
const preview = { id: 'item', version: 'a'.repeat(64), leadName: 'Practice Clinic', task: { id: 'task', title: 'Current callback task', description: 'Reviewed details', assigneeId: 'actor', assigneeName: 'Practice Owner', dueDate: stamp } }
const progress = { state: 'OVERDUE' as const, dueDate: stamp, completedAt: null, checkedAt: stamp }
const props = () => ({ id: 'item', taskId: 'task', progress, context, canWrite: true, disabled: false, onChanged: vi.fn(), onBusyChange: vi.fn(), onAccessLost: vi.fn() })
const response = (data: unknown, write = true, scope = context) => new Response(JSON.stringify({ data, scope, capabilities: { canWrite: write } }))
const confirmed = (requestId: string) => ({ id: 'item', requestId, state: 'confirmed', task: { id: 'task', dueDate: stamp, completedAt: stamp, checkedAt: stamp } })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('reviews current details without writes and cancellation returns to an unchanged card', async () => {
 const p = props(), fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(preview)); render(<FollowUpTaskCompletion {...p} />)
 fireEvent.click(screen.getByRole('button', { name: 'Review task completion' })); const group = await screen.findByRole('group', { name: 'Task completion review' })
 expect(group).toHaveTextContent('Current callback task'); expect(group).toHaveTextContent('Practice Clinic'); expect(group).toHaveTextContent('Practice Owner'); expect(group).toHaveTextContent('Reviewed details')
 fireEvent.click(within(group).getByRole('button', { name: 'Cancel completion' })); expect(screen.queryByRole('group', { name: 'Task completion review' })).not.toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]?.method ?? 'GET').toBe('GET'); expect(p.onChanged).not.toHaveBeenCalled()
})
it('requires explicit confirmation and validates the exact completion receipt', async () => {
 const p = props(), writes: unknown[] = []
 vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
  if (init?.method === 'POST') { const input = JSON.parse(String(init.body)); writes.push(input); return response(confirmed(input.requestId)) }
  return response(preview)
 })
 render(<FollowUpTaskCompletion {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Review task completion' })); await screen.findByRole('group', { name: 'Task completion review' }); expect(writes).toEqual([])
 fireEvent.click(screen.getByRole('button', { name: 'Confirm task completion' })); await screen.findByText('Task completion confirmed.'); expect(writes).toHaveLength(1); expect(writes[0]).toEqual({ requestId: expect.any(String), expectedVersion: 'a'.repeat(64), taskId: 'task' }); expect(p.onChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'item', state: 'confirmed', task: expect.objectContaining({ id: 'task' }) })); expect(screen.queryByRole('button', { name: 'Confirm task completion' })).not.toBeInTheDocument()
})
it('checks a lost response with GET only and never automatically repeats the mutation', async () => {
 const p = props(), calls: { url: string; method: string; requestId?: string }[] = []; let requestId = ''
 vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
  const method = init?.method ?? 'GET'; calls.push({ url: String(url), method })
  if (method === 'POST') { requestId = JSON.parse(String(init?.body)).requestId; throw new TypeError('Lost response') }
  return response(String(url).includes('?requestId=') ? confirmed(requestId) : preview)
 })
 render(<FollowUpTaskCompletion {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Review task completion' })); await screen.findByRole('group', { name: 'Task completion review' }); fireEvent.click(screen.getByRole('button', { name: 'Confirm task completion' }))
 await screen.findByRole('button', { name: 'Check completion result' }); expect(screen.queryByRole('button', { name: 'Confirm task completion' })).not.toBeInTheDocument(); expect(p.onChanged).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: 'Check completion result' })); await screen.findByText('Task completion confirmed.'); expect(calls.filter(call => call.method === 'POST')).toHaveLength(1); expect(calls.at(-1)).toEqual({ url: '/api/follow-ups/item/task-completion?requestId=' + requestId, method: 'GET' })
})
it.each(['wrong-request', 'wrong-task', 'read-only', 'stale-account'])('rejects a %s confirmation and does not report success', async kind => {
 const p = props(); vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
  if (init?.method !== 'POST') return response(preview)
  const input = JSON.parse(String(init.body)), receipt = confirmed(input.requestId)
  return response({ ...receipt, ...(kind === 'wrong-request' ? { requestId: '22222222-2222-4222-8222-222222222222' } : {}), ...(kind === 'wrong-task' ? { task: { ...receipt.task, id: 'wrong' } } : {}) }, kind !== 'read-only', kind === 'stale-account' ? { ...context, userId: 'other' } : context)
 })
 render(<FollowUpTaskCompletion {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Review task completion' })); await screen.findByRole('group', { name: 'Task completion review' }); fireEvent.click(screen.getByRole('button', { name: 'Confirm task completion' })); await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm task completion' })).not.toBeInTheDocument()); expect(p.onChanged).not.toHaveBeenCalled()
 if (kind === 'read-only' || kind === 'stale-account') { await waitFor(() => expect(p.onAccessLost).toHaveBeenCalled()); expect(screen.queryByText('Reviewed details')).not.toBeInTheDocument() }
 else expect(await screen.findByRole('button', { name: 'Check completion result' })).toBeEnabled()
})
it('does not offer completion for read-only, completed, missing or unavailable tasks', () => {
 for (const changes of [{ canWrite: false }, { taskId: null }, { progress: { state: 'UNAVAILABLE' as const } }, { progress: { ...progress, state: 'COMPLETED' as const } }]) {
  const ui = render(<FollowUpTaskCompletion {...props()} {...changes} />); expect(screen.queryByRole('button', { name: 'Review task completion' })).not.toBeInTheDocument(); ui.unmount()
 }
})
it('redacts the reviewed task when progress access is lost before confirmation', async () => {
 const p = props(), fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(preview)), ui = render(<FollowUpTaskCompletion {...p} />)
 fireEvent.click(screen.getByRole('button', { name: 'Review task completion' })); await screen.findByRole('group', { name: 'Task completion review' }); ui.rerender(<FollowUpTaskCompletion {...p} progress={{ state: 'UNAVAILABLE' }} />)
 await waitFor(() => expect(screen.queryByText('Reviewed details')).not.toBeInTheDocument()); expect(screen.queryByRole('button', { name: 'Confirm task completion' })).not.toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(1)
})
it('preserves the exact mounted unsent draft and Open filter after confirming completion', async () => {
 const calls: string[] = [], writes: string[] = [], row = { id: 'item', sourceType: 'EMAIL', sourceText: 'Synthetic source', title: 'Original suggestion', description: 'Notes', draftSubject: 'Quote', draftBody: 'Unsent reply', status: 'APPROVED', taskId: 'task', taskProgress: progress, lead: { id: 'lead', firstName: 'Practice', lastName: 'Clinic', email: 'lead@example.invalid' }, createdAt: stamp }
 vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
  const path = String(url); calls.push(path)
  if (path.endsWith('/task-completion')) { if (init?.method === 'POST') { writes.push(path); return response(confirmed(JSON.parse(String(init.body)).requestId)) }; return response(preview) }
  if (path.startsWith('/api/follow-ups?')) return new Response(JSON.stringify({ data: path.includes('status=APPROVED') ? [row] : [], scope: context, capabilities: { canWrite: true, taskProgress: true } }))
  throw new Error('Unexpected request ' + path)
 })
 render(<FollowUpInbox canWrite emailMatchContext={context} />); await screen.findByText('No pending follow-ups'); fireEvent.click(screen.getByRole('tab', { name: 'Approved' })); await screen.findByText('Synthetic source'); fireEvent.change(screen.getByRole('combobox', { name: 'Task progress' }), { target: { value: 'OPEN' } }); fireEvent.click(screen.getByRole('button', { name: 'Apply filters' })); await waitFor(() => expect(calls.at(-1)).toContain('taskProgress=OPEN')); await screen.findByText('Synthetic source')
 fireEvent.click(screen.getByRole('button', { name: 'Review email draft' })); const subject = screen.getByLabelText('Unsent completion subject'); fireEvent.change(subject, { target: { value: 'Keep completed draft edits' } })
 fireEvent.click(screen.getByRole('button', { name: 'Review task completion' })); await screen.findByRole('group', { name: 'Task completion review' }); fireEvent.click(screen.getByRole('button', { name: 'Confirm task completion' })); await screen.findByText('Task completion confirmed.')
 expect(screen.getByLabelText('Unsent completion subject')).toBe(subject); expect(subject).toHaveValue('Keep completed draft edits'); expect(screen.getByRole('combobox', { name: 'Task progress' })).toHaveValue('OPEN'); expect(within(screen.getByRole('article', { name: 'Follow-up for Practice Clinic' })).getByText((_text, el) => el?.textContent === 'Completed')).toBeInTheDocument(); expect(writes).toEqual(['/api/follow-ups/item/task-completion']); expect(calls.filter(path => /draft|send/.test(path))).toEqual([])
})
