import {filterScreen} from './test-helpers/filter-screen'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FollowUpInbox } from './follow-up-inbox'
vi.mock('./email-match-inbox', () => ({ EmailMatchInbox: () => null }))
vi.mock('@/components/email/email-compose', () => ({ EmailCompose: () => <label>Unsent progress subject<input defaultValue="Keep draft" /></label> }))
const context = { organizationId: 'org', userId: 'actor' }, checkedAt = '2026-11-06T01:00:00.000Z'
const progress = (state: string) => state === 'UNAVAILABLE' ? { state } : { state, dueDate: state === 'OPEN' ? '2026-11-08T00:00:00.000Z' : '2026-11-05T00:00:00.000Z', completedAt: state === 'COMPLETED' ? '2026-11-06T00:30:00.000Z' : null, checkedAt }
const rows = ['OPEN', 'OVERDUE', 'COMPLETED', 'UNAVAILABLE'].map((state, i) => ({ id: `item-${i}`, sourceType: 'EMAIL', sourceText: `Synthetic source ${i}`, title: `Task ${i}`, description: 'Notes', draftSubject: 'Quote', draftBody: 'Draft', status: 'APPROVED', taskId: `task-${i}`, lead: { id: 'lead', firstName: `Practice ${i}`, lastName: 'Clinic', email: 'lead@example.invalid' }, createdAt: checkedAt, taskProgress: progress(state) }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function setup(write = true) {
 const state = { calls: [] as string[], unavailable: false, supported: true }
 vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
  expect(init?.method ?? 'GET').toBe('GET'); const path = String(url); state.calls.push(path); const q = new URL(path, 'https://example.invalid').searchParams
  const reply = (data: unknown) => new Response(JSON.stringify({ data, scope: context, capabilities: { canWrite: write, ...(state.supported ? { taskProgress: true } : {}) } }))
  if (path === '/api/follow-up-views') return reply([{ id: '11111111-1111-4111-8111-111111111111', name: 'Finished callbacks', settings: { status: 'APPROVED', filters: { search: '', source: 'ALL', dueOnly: false, taskProgress: 'COMPLETED' } }, revision: 1, updatedAt: checkedAt }])
  if (path.startsWith('/api/follow-ups?')) { let result = q.get('status') === 'APPROVED' ? rows.map(row => state.unavailable ? { ...row, taskProgress: { state: 'UNAVAILABLE' } } : row) : []; const filter = q.get('taskProgress'); if (filter) result = result.filter(row => row.taskProgress.state === filter || filter === 'OPEN' && row.taskProgress.state === 'OVERDUE'); return reply(result) }
  throw new Error(`Unexpected request ${path}`)
 })
 render(<FollowUpInbox canWrite={write} emailMatchContext={context} />); await screen.findByText('No pending follow-ups'); fireEvent.click(screen.getByRole('tab', { name: 'Approved' })); await screen.findByText('Synthetic source 0'); return state
}
const card = (n: number) => screen.getByRole('article', { name: `Follow-up for Practice ${n} Clinic` })
it('shows server task state, due and completion dates, and no inaccessible task link', async () => {
 await setup(false); expect(within(card(0)).getByText('Open')).toBeInTheDocument(); expect(within(card(1)).getByText('Overdue')).toBeInTheDocument(); expect(within(card(2)).getByText((_content, element) => element?.textContent === 'Completed')).toBeInTheDocument(); expect(card(2).querySelector('time[datetime="2026-11-06T00:30:00.000Z"]')).toBeInTheDocument(); expect(within(card(3)).getByText('Progress unavailable')).toBeInTheDocument(); expect(within(card(3)).queryByRole('link', { name: 'Open task' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Approve task' })).not.toBeInTheDocument()
})
it('applies open/overdue/completed filters and clears progress when leaving Approved', async () => {
 const state = await setup(); const select = filterScreen().getByRole('combobox', { name: 'Task progress' })
 for (const value of ['OPEN', 'OVERDUE', 'COMPLETED']) { fireEvent.change(select, { target: { value } }); fireEvent.click(filterScreen().getByRole('button', { name: 'Apply filters' })); await waitFor(() => expect(state.calls.at(-1)).toContain(`taskProgress=${value}`)); await waitFor(() => expect(filterScreen().getByRole('button', { name: 'Apply filters' })).toBeEnabled()) }
 fireEvent.click(screen.getByRole('tab', { name: 'Pending' })); await screen.findByText('No pending follow-ups'); expect(state.calls.at(-1)).toBe('/api/follow-ups?status=PENDING'); expect(filterScreen().queryByRole('combobox', { name: 'Task progress' })).not.toBeInTheDocument()
})
it('protects an unsent draft before applying a saved progress view', async () => {
 const state = await setup(); fireEvent.click(within(card(0)).getByRole('button', { name: 'Review email draft' })); fireEvent.change(screen.getByLabelText('Unsent progress subject'), { target: { value: 'Keep progress edits' } })
 const details = screen.getByText('Saved views').closest('details')!; details.open = true; fireEvent(details, new Event('toggle')); await screen.findByRole('option', { name: 'Finished callbacks' }); fireEvent.change(screen.getByLabelText('Saved follow-up view'), { target: { value: '11111111-1111-4111-8111-111111111111' } }); const before = state.calls.length; fireEvent.click(screen.getByRole('button', { name: 'Apply view' })); expect(screen.getByRole('group', { name: 'Open draft confirmation' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Keep editing' })); expect(screen.getByLabelText('Unsent progress subject')).toHaveValue('Keep progress edits'); expect(state.calls).toHaveLength(before)
 fireEvent.click(screen.getByRole('button', { name: 'Apply view' })); fireEvent.click(screen.getByRole('button', { name: 'Discard and apply view' })); await waitFor(() => expect(state.calls.at(-1)).toContain('taskProgress=COMPLETED')); expect(screen.getByRole('tab', { name: 'Approved' })).toHaveAttribute('aria-selected', 'true')
})
it('removes stale dates and links after access-safe refresh without replacing the composer', async () => {
 const state = await setup(); fireEvent.click(within(card(0)).getByRole('button', { name: 'Review email draft' })); fireEvent.change(screen.getByLabelText('Unsent progress subject'), { target: { value: 'Keep redaction draft' } }); state.unavailable = true; fireEvent.focus(window)
 await waitFor(() => expect(within(card(0)).getByText('Progress unavailable')).toBeInTheDocument()); expect(within(card(0)).queryByRole('link', { name: 'Open task' })).not.toBeInTheDocument(); expect(card(0).querySelector('time[datetime="2026-11-08T00:00:00.000Z"]')).not.toBeInTheDocument(); expect(screen.getByLabelText('Unsent progress subject')).toHaveValue('Keep redaction draft')
})
it('keeps an Approved draft or explicitly opens a reply without carrying the progress filter into Pending', async () => {
 const first = '11111111-1111-4111-8111-111111111111', next = '22222222-2222-4222-8222-222222222222', calls: string[] = []
 vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
  expect(init?.method ?? 'GET').toBe('GET'); const path = String(url); calls.push(path); const reply = (data: unknown) => new Response(JSON.stringify({ data, scope: context, capabilities: { canWrite: true, taskProgress: true } }))
  if (path.includes('/api/email-notifications/follow-up/')) return reply({ ...rows[0], id: path.split('/').at(-1), status: 'PENDING', taskId: null, sourceText: 'Focused pending reply', lead: { ...rows[0].lead, id: '33333333-3333-4333-8333-333333333333' }, taskProgress: undefined })
  const q = new URL(path, 'https://example.invalid').searchParams
  if (q.get('status') === 'PENDING' && q.has('taskProgress')) return new Response(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Task progress belongs in Approved.' } }), { status: 400 })
  return reply(q.get('status') === 'APPROVED' ? [rows[0]] : [])
 })
 const ui = render(<FollowUpInbox canWrite emailMatchContext={context} />); await screen.findByText('No pending follow-ups'); fireEvent.click(screen.getByRole('tab', { name: 'Approved' })); await screen.findByText('Synthetic source 0'); fireEvent.change(filterScreen().getByRole('combobox', { name: 'Task progress' }), { target: { value: 'OPEN' } }); fireEvent.click(filterScreen().getByRole('button', { name: 'Apply filters' })); await waitFor(() => expect(calls.at(-1)).toContain('taskProgress=OPEN')); await screen.findByText('Synthetic source 0')
 fireEvent.click(within(card(0)).getByRole('button', { name: 'Review email draft' })); fireEvent.change(screen.getByLabelText('Unsent progress subject'), { target: { value: 'Keep notification edits' } }); ui.rerender(<FollowUpInbox canWrite emailMatchContext={context} initialReplyId={first} />); await screen.findByRole('group', { name: 'Open draft confirmation' }); fireEvent.click(screen.getByRole('button', { name: 'Keep editing' })); expect(screen.getByLabelText('Unsent progress subject')).toHaveValue('Keep notification edits'); expect(filterScreen().getByRole('combobox', { name: 'Task progress' })).toHaveValue('OPEN'); expect(calls.some(path => path.includes(`/follow-up/${first}`))).toBe(false)
 ui.rerender(<FollowUpInbox canWrite emailMatchContext={context} initialReplyId={next} />); await screen.findByRole('group', { name: 'Open draft confirmation' }); fireEvent.click(screen.getByRole('button', { name: 'Discard and open reply' })); await screen.findByText('Focused pending reply'); expect(screen.getByRole('tab', { name: 'Pending' })).toHaveAttribute('aria-selected', 'true'); expect(filterScreen().queryByRole('combobox', { name: 'Task progress' })).not.toBeInTheDocument(); expect(screen.queryByLabelText('Unsent progress subject')).not.toBeInTheDocument(); expect(calls.filter(path => path.startsWith('/api/follow-ups?status=PENDING')).every(path => !path.includes('taskProgress'))).toBe(true)
})
