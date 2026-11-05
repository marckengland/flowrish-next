import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FollowUpInbox } from './follow-up-inbox'
vi.mock('./email-match-inbox', () => ({ EmailMatchInbox: () => null }))
vi.mock('@/components/email/email-compose', () => ({ EmailCompose: () => <label>Unsent subject<input defaultValue="Original" /></label> }))
const context = { organizationId: 'org', userId: 'user' }
const saved = { id: '11111111-1111-4111-8111-111111111111', name: 'Reviewed callbacks', settings: { status: 'APPROVED', filters: { search: 'Clinic', source: 'CALL', dueOnly: false } }, revision: 1, updatedAt: '2026-11-06T00:00:00.000Z' }
const item = { id: 'reply', sourceType: 'EMAIL', sourceText: 'Synthetic source', title: 'Call Jane', description: 'Notes', draftSubject: 'Re: quote', draftBody: 'Draft', status: 'PENDING', taskId: null, lead: { id: 'lead', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.invalid' }, createdAt: '2026-11-06T00:00:00.000Z' }
const reply = (data: unknown) => new Response(JSON.stringify({ data, scope: context, capabilities: { canWrite: true } }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function setup() {
  const calls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    expect(init?.method ?? 'GET').toBe('GET'); const path = String(url); calls.push(path)
    if (path === '/api/follow-up-views') return reply([saved])
    if (path.startsWith('/api/follow-ups?')) return reply([item])
    throw new Error(`Unexpected request: ${path}`)
  })
  render(<FollowUpInbox canWrite emailMatchContext={context} />); await screen.findByText(item.sourceText)
  expect(calls).toHaveLength(1)
  const details = screen.getByText('Saved views').closest('details')!; details.open = true; fireEvent(details, new Event('toggle'))
  await screen.findByRole('option', { name: saved.name }); fireEvent.change(screen.getByLabelText('Saved follow-up view'), { target: { value: saved.id } })
  return calls
}
it('applies the saved tab and filters together only after confirming unsent email loss', async () => {
  const calls = await setup(); fireEvent.click(screen.getByRole('button', { name: 'Review email draft' })); fireEvent.change(screen.getByLabelText('Unsent subject'), { target: { value: 'Keep these edits' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply view' })); expect(screen.getByLabelText('Unsent subject')).toHaveValue('Keep these edits'); expect(calls).toHaveLength(2)
  fireEvent.click(within(screen.getByRole('group', { name: 'Open draft confirmation' })).getByRole('button', { name: 'Keep editing' })); expect(screen.getByLabelText('Unsent subject')).toHaveValue('Keep these edits')
  fireEvent.click(screen.getByRole('button', { name: 'Apply view' })); fireEvent.click(screen.getByRole('button', { name: 'Discard and apply view' }))
  await waitFor(() => expect(calls.at(-1)).toBe('/api/follow-ups?status=APPROVED&search=Clinic&source=CALL'))
  expect(screen.getByRole('tab', { name: 'Approved' })).toHaveAttribute('aria-selected', 'true'); expect(screen.getByRole('searchbox', { name: 'Search follow-ups' })).toHaveValue('Clinic'); expect(calls).toHaveLength(3)
})
it('protects unsaved task edits when applying a saved view, without mutating follow-ups', async () => {
  const calls = await setup(); fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Keep task edits' } }); fireEvent.click(screen.getByRole('button', { name: 'Apply view' }))
  expect(screen.getByRole('group', { name: 'Open draft confirmation' })).toBeInTheDocument(); expect(screen.getByLabelText('Task title')).toHaveValue('Keep task edits'); expect(calls).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' })); expect(screen.getByLabelText('Task title')).toHaveValue('Keep task edits'); expect(calls).toHaveLength(2)
})
it('keeps unfinished saved-view edits when the section is collapsed and reopened', async () => {
  const calls = await setup(); fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Unfinished saved name' } })
  const details = screen.getByText('Saved views').closest('details')!; details.open = false; fireEvent(details, new Event('toggle'))
  details.open = true; fireEvent(details, new Event('toggle'))
  expect(screen.getByLabelText('View name')).toHaveValue('Unfinished saved name'); expect(calls).toHaveLength(2)
})
