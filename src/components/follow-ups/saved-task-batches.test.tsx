import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SavedTaskBatches } from './saved-task-batches'
const context = { organizationId: 'org', userId: 'actor' }, id = '22222222-2222-4222-8222-222222222222', at = '2026-11-06T00:00:00.000Z'
const counts = { confirmed: 1, failed: 0, uncertain: 0, 'not-attempted': 1, unavailable: 0 }
const summary = { id, kind: 'COMPLETE', createdAt: at, counts }
const detail = { id, kind: 'COMPLETE', createdAt: at, checkedAt: at, items: [{ index: 0, state: 'confirmed', currentChanged: true, task: { id: 'task', title: 'Current CRM task', leadId: 'lead', leadName: 'Practice Clinic', dueDate: at, isComplete: true } }, { index: 1, state: 'unavailable' }] }
const reply = (data: unknown, wrong = false) => new Response(JSON.stringify({ data, scope: wrong ? { ...context, userId: 'other' } : context, capabilities: { canWrite: false } }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('lazily reads saved results with no writes and preserves neighboring unsent edits', async () => {
 const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => reply(String(url).endsWith(id) ? detail : { items: [summary], nextCursor: null }))
 render(<><label>Unsent draft<input defaultValue="keep" /></label><SavedTaskBatches context={context} onAccessLost={vi.fn()} /></>)
 expect(fetcher).not.toHaveBeenCalled(); fireEvent.change(screen.getByLabelText('Unsent draft'), { target: { value: 'keep exact edits' } })
 const panel = screen.getByText('Saved bulk-action history').closest('details')!; panel.open = true; fireEvent(panel, new Event('toggle'))
 fireEvent.click(await screen.findByRole('button', { name: /View completion batch/ }))
 expect(await screen.findByText('Current CRM task')).toBeInTheDocument(); for (const name of ['Open task (new tab)', 'Open lead (new tab)']) { const link = screen.getByRole('link', { name }); expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', 'noopener noreferrer'); fireEvent.click(link); expect(screen.getByLabelText('Unsent draft')).toHaveValue('keep exact edits') }; expect(screen.getByText('Changed since this action.')).toBeInTheDocument(); expect(screen.getByText('Unavailable task')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button', { name: 'Check saved results' })); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4))
 expect(screen.getByLabelText('Unsent draft')).toHaveValue('keep exact edits'); expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
 expect(screen.queryByRole('button', { name: /resume|retry task/i })).not.toBeInTheDocument()
})
it('clears private details on stale scope and never writes from read-only history', async () => {
 let wrong = false
 const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => reply(String(url).endsWith(id) ? detail : { items: [summary], nextCursor: null }, wrong)), lost = vi.fn()
 render(<SavedTaskBatches context={context} onAccessLost={lost} />)
 const panel = screen.getByText('Saved bulk-action history').closest('details')!; panel.open = true; fireEvent(panel, new Event('toggle')); fireEvent.click(await screen.findByRole('button', { name: /View completion batch/ })); await screen.findByText('Current CRM task')
 wrong = true; fireEvent.focus(window); await waitFor(() => expect(lost).toHaveBeenCalled()); expect(screen.queryByText('Current CRM task')).not.toBeInTheDocument(); expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
})
it('loads older history and ignores responses after workspace changes', async () => {
 let release!: (value: Response) => void
 const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply({ items: [summary], nextCursor: 'older' })).mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve }))
 const ui = render(<SavedTaskBatches context={context} onAccessLost={vi.fn()} />)
 const panel = screen.getByText('Saved bulk-action history').closest('details')!; panel.open = true; fireEvent(panel, new Event('toggle')); fireEvent.click(await screen.findByRole('button', { name: 'Older batches' })); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
 ui.rerender(<SavedTaskBatches context={{ ...context, organizationId: 'other' }} onAccessLost={vi.fn()} />); release(reply({ items: [{ ...summary, id: '11111111-1111-4111-8111-111111111111' }], nextCursor: null }))
 expect(within(screen.getByRole('group', { name: 'Saved task batch history' })).queryByRole('button', { name: /View completion batch/ })).not.toBeInTheDocument()
})
