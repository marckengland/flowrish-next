import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FollowUpInbox } from './follow-up-inbox'
vi.mock('./email-match-inbox', () => ({ EmailMatchInbox: () => null }))
vi.mock('@/components/email/email-compose', () => ({ EmailCompose: () => <label>Unsent approval subject<input defaultValue="Original" /></label> }))
const context = { organizationId: 'org', userId: 'actor' }, version = 'a'.repeat(64)
const seed = { id: 'item', sourceType: 'EMAIL', sourceText: 'Synthetic approval source', title: 'Call clinic', description: 'Notes', draftSubject: 'Quote', draftBody: 'Draft', status: 'PENDING', taskId: null as string | null, snoozeVersion: version, lead: { id: 'lead', firstName: 'Practice', lastName: 'Clinic', email: 'lead@example.invalid' }, createdAt: '2026-11-06T00:00:00.000Z' }
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function setup(write = true) {
 const calls: { path: string; method: string }[] = []; let item = { ...seed }
 vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
  const path = String(url), method = init?.method ?? 'GET'; calls.push({ path, method }); const reply = (data: unknown) => new Response(JSON.stringify({ data, scope: context, capabilities: { canWrite: write } }))
  if (path.startsWith('/api/follow-ups?') && method === 'GET') return reply([item])
  if (path === '/api/follow-ups/item/approval' && method === 'GET') return reply({ id: 'item', version, sourceType: 'EMAIL', assigneeId: 'actor', title: item.title, description: item.description, existingTask: null, leadName: 'Practice Clinic' })
  if (path === '/api/follow-ups/item/approval' && method === 'POST') { const input = JSON.parse(String(init?.body)); item = { ...item, status: 'APPROVED', taskId: 'task', title: input.title }; return reply({ id: 'item', requestId: input.requestId, state: 'confirmed', task: { id: 'task', assigneeId: 'actor', title: input.title, description: input.description, dueDate: input.dueDate } }) }
  throw new Error(`Unexpected request: ${method} ${path}`)
 })
 render(<FollowUpInbox canWrite={write} emailMatchContext={context} />); await screen.findByText(seed.sourceText); return calls
}
async function open() { fireEvent.change(screen.getByRole('combobox', { name: 'Bulk actions' }), { target: { value: 'approve' } }); await screen.findByRole('button', { name: 'Select up to 20 for approval' }); fireEvent.click(screen.getByRole('button', { name: 'Select up to 20 for approval' })) }
it('preserves the mounted email draft and filters while approving, refreshing and clearing selection', async () => {
 const calls = await setup(); const filters = screen.getByRole('search', { name: 'Follow-up filters' }); fireEvent.change(within(filters).getByRole('searchbox'), { target: { value: 'Clinic' } }); fireEvent.click(within(filters).getByRole('button', { name: 'Apply filters' })); await screen.findByText(seed.sourceText)
 fireEvent.click(screen.getByRole('button', { name: 'Review email draft' })); fireEvent.change(screen.getByLabelText('Unsent approval subject'), { target: { value: 'Keep email edits' } }); const subject = screen.getByLabelText('Unsent approval subject'); subject.setAttribute('data-mounted', 'original')
 await open(); fireEvent.click(screen.getByRole('button', { name: 'Review task approvals' })); await screen.findByLabelText('Approval task title for Practice Clinic'); fireEvent.change(screen.getByLabelText('Approval task title for Practice Clinic'), { target: { value: 'Approved bulk title' } }); expect(calls.every(row => row.method === 'GET')).toBe(true)
 fireEvent.click(screen.getByRole('button', { name: 'Confirm bulk approval' })); await screen.findByText('1 of 1 task approvals confirmed or verified.'); expect(await screen.findByRole('link', { name: 'Open task' })).toHaveAttribute('href', '/tasks/task'); expect(screen.getByText('Approved bulk title')).toBeInTheDocument(); expect(subject).toHaveValue('Keep email edits'); expect(subject).toHaveAttribute('data-mounted', 'original'); expect(within(filters).getByRole('searchbox')).toHaveValue('Clinic')
 fireEvent.focus(window); await waitFor(() => expect(calls.at(-1)?.path).toContain('retain=item')); expect(subject).toHaveValue('Keep email edits'); fireEvent.click(screen.getByRole('button', { name: 'Clear approval selection' })); expect(subject).toHaveValue('Keep email edits'); expect(calls.filter(row => row.method !== 'GET')).toEqual([{ path: '/api/follow-ups/item/approval', method: 'POST' }])
})
it('keeps unsaved card edits and blocks selecting them for task approval', async () => {
 const calls = await setup(); fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Keep task edits' } }); await open(); expect(screen.getByRole('button', { name: 'Review task approvals' })).toBeDisabled(); expect(screen.getByLabelText('Task title')).toHaveValue('Keep task edits'); expect(calls).toHaveLength(1)
})
it('hides bulk approval for read-only users without issuing preview or mutation requests', async () => {
 const calls = await setup(false); expect(screen.queryByText('Bulk task approval')).not.toBeInTheDocument(); expect(calls).toHaveLength(1)
})
it('retains confirmed selections and results until explicitly cleared', async () => {
  await setup(); await open(); fireEvent.click(screen.getByRole('button', { name: 'Review task approvals' })); await screen.findByRole('button', { name: 'Confirm bulk approval' }); fireEvent.click(screen.getByRole('button', { name: 'Confirm bulk approval' }))
  await screen.findByRole('link', { name: 'Open task' }); const region = screen.getByRole('region', { name: 'Bulk task approval' })
  expect(region).toHaveTextContent('1 selected'); expect(region).toHaveTextContent('1 of 1 task approvals confirmed or verified.'); fireEvent.click(within(region).getByRole('button', { name: 'Clear approval selection' })); expect(region).toHaveTextContent('0 selected')
})
it('retains the exact lost-response request through focus refresh and verifies with GET only', async () => {
  let committed = false, requestId = '', receipt: unknown
  const calls: { path: string; method: string }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const path = String(url), method = init?.method ?? 'GET'; calls.push({ path, method }); const reply = (data: unknown) => new Response(JSON.stringify({ data, scope: context, capabilities: { canWrite: true } }))
    if (path.startsWith('/api/follow-ups?')) return reply([{ ...seed, ...(committed ? { status: 'APPROVED', taskId: 'lost-task' } : {}) }])
    if (path.includes('?requestId=')) { expect(path).toBe(`/api/follow-ups/item/approval?requestId=${requestId}`); return reply(receipt) }
    if (path === '/api/follow-ups/item/approval' && method === 'GET') return reply({ id: 'item', version, sourceType: 'EMAIL', assigneeId: 'actor', title: seed.title, description: seed.description, existingTask: null, leadName: 'Practice Clinic' })
    if (method === 'POST' && path === '/api/follow-ups/item/approval') { const input = JSON.parse(String(init?.body)); requestId = input.requestId; committed = true; receipt = { id: 'item', requestId, state: 'confirmed', task: { id: 'lost-task', assigneeId: 'actor', title: input.title, description: input.description, dueDate: input.dueDate } }; throw new Error('Synthetic committed response loss') }
    throw new Error(`Unexpected request ${method} ${path}`)
  })
  render(<FollowUpInbox canWrite emailMatchContext={context} />); await screen.findByText(seed.sourceText); await open(); fireEvent.click(screen.getByRole('button', { name: 'Review task approvals' })); await screen.findByRole('button', { name: 'Confirm bulk approval' }); fireEvent.click(screen.getByRole('button', { name: 'Confirm bulk approval' })); await screen.findByRole('button', { name: 'Check approval results' })
  fireEvent.focus(window); await screen.findByRole('link', { name: 'Open task' }); expect(screen.getByRole('button', { name: 'Check approval results' })).toBeEnabled(); fireEvent.click(screen.getByRole('button', { name: 'Check approval results' })); await screen.findByText('Requested task approval verified.', { exact: false }); expect(calls.filter(row => row.method === 'POST')).toHaveLength(1); expect(calls.filter(row => row.path.includes('?requestId='))).toHaveLength(1)
})
it('requires explicit confirmation before navigating away from frozen approval results', async () => {
  const calls = await setup(); await open(); fireEvent.click(screen.getByRole('button', { name: 'Review task approvals' })); await screen.findByRole('button', { name: 'Confirm bulk approval' }); fireEvent.click(screen.getByRole('button', { name: 'Confirm bulk approval' })); await screen.findByRole('link', { name: 'Open task' })
  fireEvent.click(screen.getByRole('tab', { name: 'Approved' })); expect(screen.getByRole('group', { name: 'Approval results confirmation' })).toBeInTheDocument(); expect(screen.getByRole('tab', { name: 'Pending' })).toHaveAttribute('aria-selected', 'true'); fireEvent.click(screen.getByRole('button', { name: 'Keep editing' })); expect(screen.getByText('1 of 1 task approvals confirmed or verified.')).toBeInTheDocument(); expect(calls.filter(row => row.method === 'POST')).toHaveLength(1)
})
