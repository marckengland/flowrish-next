import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FollowUpSnoozeControls } from './follow-up-snooze'
const context = { organizationId: 'org', userId: 'actor' }, item = { id: 'followup', snoozeVersion: 'a'.repeat(64), snooze: null }
afterEach(() => vi.unstubAllGlobals())
it('requires draft discard before a scoped snooze, then confirms the exact returned item', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ data: { ...item, snooze: { until: '2026-11-06T01:00:00Z', timeZone: 'Asia/Manila', revision: 1 } }, scope: context, capabilities: { canWrite: true } }))), discard = vi.fn(), changed = vi.fn(); vi.stubGlobal('fetch', fetcher)
  render(<FollowUpSnoozeControls item={item} context={context} disabled={false} compose onDiscard={discard} onChanged={changed} onAccessLost={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Snooze until tomorrow' })); expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft and snooze' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce()); expect(discard).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce()
  expect(fetcher.mock.calls[0][0]).toBe('/api/follow-ups/followup/snooze')
})
it('blocks repeat writes after an uncertain response and leaves refresh explicit', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { throw new Error('Network interrupted') }); vi.stubGlobal('fetch', fetcher)
  render(<FollowUpSnoozeControls item={item} context={context} disabled={false} compose={false} onDiscard={vi.fn()} onChanged={vi.fn()} onAccessLost={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Snooze until tomorrow' })); await screen.findByText(/Refresh the inbox before trying again/)
  expect(screen.getByRole('button', { name: 'Snooze until tomorrow' })).toBeDisabled(); expect(fetcher).toHaveBeenCalledOnce()
})
