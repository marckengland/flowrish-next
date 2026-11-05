import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { FollowUpInbox } from './follow-up-inbox'
import { EmailMatchInbox } from './email-match-inbox'
const context = { organizationId: 'org', userId: 'owner' }, id = '11111111-1111-4111-8111-111111111111', leadId = '22222222-2222-4222-8222-222222222222', at = '2026-11-05T00:00:00.000Z'
const reply = { id, sourceType: 'EMAIL', sourceText: 'Requested reply preview', title: 'Requested follow-up', description: 'Confirm availability', draftSubject: null, draftBody: null, status: 'PENDING', taskId: null, lead: { id: leadId, firstName: 'Target', lastName: 'Practice', email: 'target@example.invalid' }, createdAt: at }
const fetchMock = vi.fn(), response = (data: unknown) => new Response(JSON.stringify({ data, scope: context }))
beforeEach(() => { cleanup(); vi.resetAllMocks(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockImplementation(async (url: string) => url.includes('/follow-up/') ? response(reply) : response([])) })
it('reads the exact focused reply even when absent from the normal inbox page without auto-actions', async () => {
  render(<FollowUpInbox canWrite={false} emailMatchContext={context} initialReplyId={id} />); expect(await screen.findByText('Requested follow-up')).toBeInTheDocument(); expect(screen.getByRole('article', { name: 'Follow-up for Target Practice' })).toHaveAttribute('id', `follow-up-${id}`); expect(fetchMock.mock.calls.every(([, options]) => (!options?.method || options.method === 'GET'))).toBe(true); expect(fetchMock.mock.calls.some(([url]) => url === `/api/email-notifications/follow-up/${id}`)).toBe(true)
})
it('opens only the requested match preview, including one outside the first page, with no mutation', async () => {
  const item = { id, fromEmail: 'old@example.invalid', subject: 'Targeted match', bodyPreview: 'Review this', sentAt: at, mailboxEmail: 'owner@example.invalid', reason: 'AMBIGUOUS' }
  fetchMock.mockImplementation(async (url: string) => url.endsWith('/preview') ? response({ message: item, version: 'a'.repeat(64), candidates: [], restrictedMatches: true, blocked: false }) : response([]))
  render(<EmailMatchInbox context={context} canWrite={false} onResolved={vi.fn()} initialMessageId={id} />); await screen.findByRole('heading', { name: 'Targeted match' }); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)); expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST').map(([url]) => url)).toEqual([`/api/email/matches/${id}/preview`]); expect(screen.queryByRole('button', { name: 'Confirm email match' })).not.toBeInTheDocument()
})
it('shows an unavailable notice for a resolved focused reply without falling back to private stale data', async () => {
  fetchMock.mockImplementation(async (url: string) => url.includes('/follow-up/') ? new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Requested reply is no longer available.' } }), { status: 404 }) : response([])); render(<FollowUpInbox canWrite={false} emailMatchContext={context} initialReplyId={id} />); await screen.findByText('Requested reply is no longer available.'); expect(screen.queryByText('Requested follow-up')).not.toBeInTheDocument(); expect(fetchMock.mock.calls.every(([, options]) => (!options?.method || options.method === 'GET'))).toBe(true)
})
it('does not display another account’s inbox when a focused target response changes scope', async () => {
  fetchMock.mockImplementation(async (url: string) => url.includes('/follow-up/') ? new Response(JSON.stringify({ data: reply, scope: { ...context, userId: 'other' } })) : url.includes('/api/follow-ups?') ? response([{ ...reply, id: '33333333-3333-4333-8333-333333333333', title: 'Other account private follow-up' }]) : response([])); render(<FollowUpInbox canWrite={false} emailMatchContext={context} initialReplyId={id} />); await screen.findByText('The account or business changed. Reload before continuing.'); expect(screen.queryByText('Other account private follow-up')).not.toBeInTheDocument()
})
