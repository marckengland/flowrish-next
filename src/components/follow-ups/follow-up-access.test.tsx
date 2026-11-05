import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/components/email/email-compose', () => ({ EmailCompose: () => <textarea aria-label="Private draft" defaultValue="Confidential edit" /> }))
import { FollowUpInbox } from './follow-up-inbox'
const context = { organizationId: 'org', userId: 'actor' }, id = '11111111-1111-4111-8111-111111111111'
const item = { id, sourceType: 'EMAIL', sourceText: 'Private source preview', title: 'Private task', description: 'Private notes', draftSubject: 'Re: Proposal', draftBody: 'Private template', status: 'PENDING', taskId: null, lead: { id: '22222222-2222-4222-8222-222222222222', firstName: 'Private', lastName: 'Practice', email: 'lead@example.invalid' }, createdAt: '2026-11-05T00:00:00.000Z' }
const fetchMock = vi.fn(), response = (data: unknown, canWrite = true) => new Response(JSON.stringify({ data, scope: context, capabilities: { canWrite } }))
beforeEach(() => { cleanup(); vi.resetAllMocks(); vi.stubGlobal('fetch', fetchMock); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); fetchMock.mockImplementation(async (url: string) => url === '/api/email/matches' ? response([]) : response([item])) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('uses immutable actor/workspace headers and current read-only capability', async () => {
  fetchMock.mockImplementation(async (url: string) => response(url === '/api/email/matches' ? [] : [item], false)); render(<FollowUpInbox canWrite emailMatchContext={context} />); await screen.findByText('Private source preview'); expect(screen.queryByRole('button', { name: 'Approve task' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Generate contextual draft' })).not.toBeInTheDocument(); const call = fetchMock.mock.calls.find(([url]) => url.startsWith('/api/follow-ups?')); expect(call?.[1]?.headers).toMatchObject({ 'x-flowrish-workspace': 'org', 'x-flowrish-follow-up-scope': JSON.stringify(['org', 'actor']) })
})
it('removes cached source details and open drafts on revoked approval access', async () => {
  render(<FollowUpInbox canWrite emailMatchContext={context} />); fireEvent.click(await screen.findByRole('button', { name: 'Review email draft' })); await screen.findByRole('textbox', { name: 'Private draft' }); fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Permission revoked' } }), { status: 403 })); fireEvent.click(screen.getByRole('button', { name: 'Approve task' })); await screen.findByText(/Access changed.*Reload/); expect(screen.queryByText('Private source preview')).not.toBeInTheDocument(); expect(screen.queryByRole('textbox', { name: 'Private draft' })).not.toBeInTheDocument(); expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1)
})
it('retains authorized edits after a transient failure and never retries a write automatically', async () => {
  render(<FollowUpInbox canWrite emailMatchContext={context} />); fireEvent.change(await screen.findByRole('textbox', { name: 'Task title' }), { target: { value: 'Retain my edit' } }); fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporary failure' } }), { status: 503 })); fireEvent.click(screen.getByRole('button', { name: 'Approve task' })); await screen.findByText('Temporary failure'); expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue('Retain my edit'); expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1)
})
it('revalidates visible access without unmounting an authorized open draft, then closes it on write loss', async () => {
  vi.useFakeTimers(); let write = true; fetchMock.mockImplementation(async (url: string) => response(url === '/api/email/matches' ? [] : [item], write)); await act(async () => { render(<FollowUpInbox canWrite emailMatchContext={context} />) }); fireEvent.click(screen.getByRole('button', { name: 'Review email draft' })); fireEvent.change(screen.getByRole('textbox', { name: 'Private draft' }), { target: { value: 'Keep this authorized edit' } }); await act(async () => { await vi.advanceTimersByTimeAsync(60000) }); expect(screen.getByRole('textbox', { name: 'Private draft' })).toHaveValue('Keep this authorized edit'); write = false; await act(async () => { await vi.advanceTimersByTimeAsync(60000) }); expect(screen.queryByRole('textbox', { name: 'Private draft' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Approve task' })).not.toBeInTheDocument(); expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
})
it('clears a stale-account list response instead of displaying the new actor’s data', async () => {
  fetchMock.mockImplementation(async (url: string) => url === '/api/email/matches' ? response([]) : new Response(JSON.stringify({ data: [item], scope: { ...context, userId: 'other' }, capabilities: { canWrite: true } }))); render(<FollowUpInbox canWrite emailMatchContext={context} />); await waitFor(() => expect(screen.queryByText('Private source preview')).not.toBeInTheDocument()); await screen.findByText(/Access changed.*Reload/)
})
it('retains an approved open draft across status-filtered refreshes using explicit retained IDs', async () => {
  vi.useFakeTimers(); let approved = false
  fetchMock.mockImplementation(async (url: string, options) => {
    if (url === '/api/email/matches') return response([])
    if (options?.method === 'PATCH') { approved = true; return response({ ...item, status: 'APPROVED', taskId: 'task' }) }
    const retained = new URL(url, 'https://example.invalid').searchParams.getAll('retain')
    return response(approved && !retained.includes(id) ? [] : [{ ...item, ...(approved ? { status: 'APPROVED', taskId: 'task' } : {}) }])
  })
  await act(async () => { render(<FollowUpInbox canWrite emailMatchContext={context} />) }); fireEvent.click(screen.getByRole('button', { name: 'Review email draft' })); fireEvent.change(screen.getByRole('textbox', { name: 'Private draft' }), { target: { value: 'Approved but still unsent' } }); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve task' })) }); await act(async () => { await vi.advanceTimersByTimeAsync(60000) }); expect(screen.getByRole('textbox', { name: 'Private draft' })).toHaveValue('Approved but still unsent'); expect(fetchMock.mock.calls.some(([url]) => new URL(url, 'https://example.invalid').searchParams.getAll('retain').includes(id))).toBe(true)
})
it('ignores an older poll after a row-scoped access denial removes private content', async () => {
  vi.useFakeTimers(); let release!: (value: Response) => void, held = false
  fetchMock.mockImplementation(async (url: string, options) => {
    if (url === '/api/email/matches') return response([])
    if (options?.method === 'PATCH') return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No current lead access' } }), { status: 404 })
    if (held) return new Promise<Response>(resolve => { release = resolve })
    return response([item])
  })
  await act(async () => { render(<FollowUpInbox canWrite emailMatchContext={context} />) }); held = true; await act(async () => { vi.advanceTimersByTime(60000) }); expect(release).toBeTypeOf('function'); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve task' })) }); expect(screen.queryByText('Private source preview')).not.toBeInTheDocument(); await act(async () => { release(response([item])) }); expect(screen.queryByText('Private source preview')).not.toBeInTheDocument()
})
