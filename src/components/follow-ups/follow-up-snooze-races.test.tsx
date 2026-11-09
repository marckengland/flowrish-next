import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FollowUpInbox } from './follow-up-inbox'
import { FollowUpSnoozeControls } from './follow-up-snooze'
vi.mock('@/components/email/email-compose', () => ({ EmailCompose: () => <form aria-label="Synthetic composer"><input aria-label="Synthetic draft" /></form> }))
const context = { organizationId: 'org', userId: 'actor' }, id = '77777777-7777-4777-8777-777777777777'
const item = { id, sourceType: 'EMAIL' as const, sourceText: 'Synthetic source', title: 'Review reply', description: 'Synthetic notes', draftSubject: 'Proposal', draftBody: 'Unsent template', status: 'PENDING', taskId: null, lead: { id: '11111111-1111-4111-8111-111111111111', firstName: 'Practice', lastName: 'Clinic', email: 'lead@example.invalid' }, createdAt: '2026-11-05T00:00:00.000Z', snoozeVersion: 'a'.repeat(64), snooze: null }
const saved = { ...item, snoozeVersion: 'b'.repeat(64), snooze: { until: '2026-11-06T01:00:00.000Z', timeZone: 'Asia/Manila', revision: 1 } }
const ok = (data: unknown) => new Response(JSON.stringify({ data, scope: context, capabilities: { canWrite: true } }))
afterEach(() => vi.unstubAllGlobals())
it('blocks composing, review and generation while a snooze save is in flight', async () => {
  let finish!: (response: Response) => void
  const held = new Promise<Response>(resolve => { finish = resolve }), writes: string[] = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith('/snooze')) { writes.push(String(url)); return held }
    if (init?.method && init.method !== 'GET') throw new Error('Unexpected write')
    return ok(String(url).startsWith('/api/follow-ups') ? [item] : [])
  }))
  render(<FollowUpInbox canWrite emailMatchContext={context} />)
fireEvent.click(await screen.findByRole('button', { name: 'Review follow-up' }));   const snooze = await screen.findByRole('button', { name: 'Snooze until tomorrow' }); await waitFor(() => expect(snooze).toBeEnabled()); fireEvent.click(snooze)
  expect(screen.getByRole('button', { name: 'Review email draft' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Approve task' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Generate contextual draft' })).toBeDisabled()
  expect(screen.queryByRole('form', { name: 'Synthetic composer' })).toBeNull()
  finish(ok(saved)); await waitFor(() => expect(screen.queryByText('Synthetic source')).toBeNull()); expect(writes).toHaveLength(1)
})
it('clears saving after a refresh observes the committed revision before its delayed receipt', async () => {
  let finish!: (response: Response) => void
  const held = new Promise<Response>(resolve => { finish = resolve }), changed = vi.fn()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockReturnValue(held))
  const props = { context, disabled: false, compose: false, onDiscard: vi.fn(), onChanged: changed, onAccessLost: vi.fn() }
  const view = render(<FollowUpSnoozeControls {...props} item={saved} />)
  fireEvent.click(screen.getByRole('button', { name: 'Snooze until tomorrow' }))
  const refreshed = { ...saved, snoozeVersion: 'c'.repeat(64), snooze: { ...saved.snooze, revision: 2 } }
  view.rerender(<FollowUpSnoozeControls {...props} item={refreshed} />)
  finish(ok(refreshed))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Snooze until tomorrow' })).toBeEnabled())
  expect(screen.queryByText('Saving snooze…')).toBeNull(); expect(changed).not.toHaveBeenCalled()
})
it('shows a just-snoozed reminder target in Snoozed even with its originating deep link', async () => {
  let changed = false
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = String(url)
    if (path.endsWith('/snooze')) { changed = true; return ok(saved) }
    if (init?.method && init.method !== 'GET') throw new Error('Unexpected write')
    if (path.startsWith('/api/email-notifications/follow-up/')) return ok(item)
    return ok(path.includes('status=SNOOZED') && changed ? [saved] : [])
  }); vi.stubGlobal('fetch', fetcher)
  render(<FollowUpInbox canWrite emailMatchContext={context} initialReplyId={id} />)
fireEvent.click(await screen.findByRole('button', { name: 'Review follow-up' }));   const snooze = await screen.findByRole('button', { name: 'Snooze until tomorrow' }); await waitFor(() => expect(snooze).toBeEnabled()); fireEvent.click(snooze)
  await screen.findByText('Follow-up snoozed. Find it in Snoozed.')
  await waitFor(() => expect(screen.queryByRole('article', { name: 'Follow-up for Practice Clinic' })).toBeNull())
  fireEvent.click(screen.getByRole('tab', { name: /^Snoozed$/ }))
  expect(await screen.findByRole('article', { name: 'Follow-up for Practice Clinic' })).toHaveAttribute('id', `follow-up-${id}`)
  expect(fetcher.mock.calls.filter(([,init]) => init?.method === 'POST')).toHaveLength(1)
})
