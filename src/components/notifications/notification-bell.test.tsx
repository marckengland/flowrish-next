import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationBell } from './notification-bell'
const fetch = vi.fn(), ok = (unread: number) => ({ ok: true, json: async () => ({ data: { unread } }) })
beforeEach(() => { fetch.mockReset(); fetch.mockResolvedValue(ok(2)); vi.stubGlobal('fetch', fetch); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
describe('notification bell', () => {
  it('refreshes again when a read acknowledgement arrives during an older count request', async () => {
    let finish: (value: unknown) => void = () => {}; fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(ok(0))
    await act(async () => { render(<NotificationBell />) }); await act(async () => { window.dispatchEvent(new Event('flowrish:callback-notifications-changed')); finish(ok(2)) }); expect(fetch).toHaveBeenCalledTimes(2); expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument()
  })
  it('polls only while visible, refreshes after explicit changes, and never writes', async () => {
    await act(async () => { render(<NotificationBell scope="org-one" />) }); expect(screen.getByRole('link', { name: 'Notifications, 2 unread' })).toHaveAttribute('href', '/notifications'); expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) }); expect(fetch).toHaveBeenCalledTimes(2)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden' }); await act(async () => { await vi.advanceTimersByTimeAsync(60000) }); expect(fetch).toHaveBeenCalledTimes(2)
    Object.defineProperty(document, 'visibilityState', { value: 'visible' }); fetch.mockResolvedValue(ok(1)); await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }); expect(screen.getByRole('link', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
    fetch.mockResolvedValue(ok(0)); await act(async () => { window.dispatchEvent(new Event('flowrish:callback-notifications-changed')) }); expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument(); expect(fetch.mock.calls.every(call => !call[1].method)).toBe(true)
  })
  it('aborts old organization requests, ignores stale responses, and distinguishes failures from zero', async () => {
    let finish: (value: unknown) => void = () => {}; fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    let root: ReturnType<typeof render>; await act(async () => { root = render(<NotificationBell scope="old" />) }); const signal = fetch.mock.calls[0][1].signal as AbortSignal
    fetch.mockResolvedValueOnce({ ok: false }); await act(async () => { root!.rerender(<NotificationBell scope="new" />) }); expect(signal.aborted).toBe(true); expect(screen.getByRole('link', { name: /count unavailable/ })).toBeInTheDocument()
    await act(async () => { finish(ok(99)) }); expect(screen.queryByText('99')).toBeNull(); root!.unmount(); const count = fetch.mock.calls.length; await act(async () => { await vi.advanceTimersByTimeAsync(120000) }); expect(fetch).toHaveBeenCalledTimes(count)
  })
})
