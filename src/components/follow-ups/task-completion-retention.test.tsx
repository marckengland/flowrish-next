import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FollowUpInbox } from './follow-up-inbox'
vi.mock('./email-match-inbox', () => ({ EmailMatchInbox: () => null }))
const scope = { organizationId: 'org', userId: 'actor' }, stamp = '2026-11-06T01:00:00.000Z'
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it.each(['OPEN', 'OVERDUE'])('retains an uncertain completion under %s across focus refresh without a composer or repeated POST', async filter => {
 const lists: URLSearchParams[] = [], writes: string[] = [], checks: string[] = []
 let completed = false, requestId = ''
 const row = { id: 'item', taskId: 'task', sourceType: 'EMAIL', sourceText: 'Synthetic retained completion', title: 'Callback', description: 'Notes', status: 'APPROVED', draftSubject: null, draftBody: null, createdAt: stamp, lead: { id: 'lead', firstName: 'Practice', lastName: 'Clinic', email: null } }
 const reply = (data: unknown) => new Response(JSON.stringify({ data, scope, capabilities: { canWrite: true, taskProgress: true } }))
 vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
  const path = String(url), q = new URL(path, 'https://example.invalid').searchParams
  if (path.startsWith('/api/follow-ups?')) { lists.push(q); return reply(q.get('status') === 'APPROVED' && (!completed || !q.has('taskProgress') || q.getAll('retain').includes('item')) ? [{ ...row, taskProgress: { state: completed ? 'COMPLETED' : 'OVERDUE', dueDate: stamp, completedAt: completed ? stamp : null, checkedAt: stamp } }] : []) }
  if (path.startsWith('/api/follow-ups/item/task-completion')) {
   if (init?.method === 'POST') { writes.push(path); completed = true; requestId = JSON.parse(String(init.body)).requestId; throw new TypeError('Lost response') }
   if (q.has('requestId')) { checks.push(q.get('requestId')!); return reply({ id: 'item', requestId, state: 'confirmed', task: { id: 'task', dueDate: stamp, completedAt: stamp, checkedAt: stamp } }) }
   return reply({ id: 'item', version: 'a'.repeat(64), leadName: 'Practice Clinic', task: { id: 'task', title: 'Callback', description: 'Notes', assigneeId: 'actor', assigneeName: 'Practice Owner', dueDate: stamp } })
  }
  throw new Error('Unexpected request ' + path)
 })
 render(<FollowUpInbox canWrite emailMatchContext={scope} />); await screen.findByText('No pending follow-ups'); fireEvent.click(screen.getByRole('tab', { name: 'Approved' })); await screen.findByText('Synthetic retained completion')
 fireEvent.change(screen.getByRole('combobox', { name: 'Task progress' }), { target: { value: filter } }); fireEvent.click(screen.getByRole('button', { name: 'Apply filters' })); await waitFor(() => expect(lists.at(-1)?.get('taskProgress')).toBe(filter)); await screen.findByText('Synthetic retained completion')
 fireEvent.click(screen.getByRole('button', { name: 'Review task completion' })); await screen.findByRole('group', { name: 'Task completion review' }); fireEvent.click(screen.getByRole('button', { name: 'Confirm task completion' })); await screen.findByRole('button', { name: 'Check completion result' }); expect(writes).toHaveLength(1)
 fireEvent.focus(window); await waitFor(() => expect(lists.at(-1)?.getAll('retain')).toContain('item')); await waitFor(() => expect(screen.getByRole('button', { name: 'Check completion result' })).toBeEnabled()); expect(screen.getByRole('combobox', { name: 'Task progress' })).toHaveValue(filter)
 fireEvent.click(screen.getByRole('tab', { name: 'Pending' })); const warning = await screen.findByRole('group', { name: 'Unconfirmed task completion navigation' }); expect(warning).toHaveTextContent('Check the completion result before leaving'); fireEvent.click(screen.getByRole('button', { name: 'Stay and check completion' })); expect(screen.getByRole('tab', { name: 'Approved' })).toHaveAttribute('aria-selected', 'true')
 fireEvent.click(screen.getByRole('button', { name: 'Check completion result' })); await screen.findByText('Task completion confirmed.'); expect(checks).toEqual([requestId]); expect(writes).toHaveLength(1)
 fireEvent.focus(window); await waitFor(() => expect(lists.at(-1)?.getAll('retain')).toEqual([])); await screen.findByText('No follow-ups match these filters.'); expect(writes).toHaveLength(1)
})
