import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailSyncStatus } from './email-sync-status'

const account = { id: 'gmail-1', provider: 'gmail', email: 'rep@example.invalid', lastSyncAt: '2026-11-02T03:00:00.000Z', lastAttemptAt: '2026-11-02T03:00:00.000Z', requestedAt: null, status: 'healthy', error: null, automatic: true }
const response = (data: unknown, canWrite = true) => ({ ok: true, json: async () => ({ data, capabilities: { canWrite } }) } as Response)

beforeEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(() => vi.useRealTimers())

describe('EmailSyncStatus', () => {
  it('shows persisted mailbox health and last success without triggering a sync', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([account]))
    render(<EmailSyncStatus />)
    expect(await screen.findByText('rep@example.invalid')).toBeInTheDocument()
    expect(screen.getByText('Up to date')).toBeInTheDocument()
    expect(screen.getByText(/Automatic checks every five minutes/)).toBeInTheDocument()
    expect(screen.getByText(/Last successful sync/).querySelector('time')).toHaveAttribute('dateTime', account.lastSyncAt)
    expect(request.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })

  it.each([['queued', 'Queued'], ['running', 'Syncing…'], ['idle', 'Not synced yet']])('distinguishes %s from a successful sync', async (status, label) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([{ ...account, status, lastSyncAt: null }]))
    render(<EmailSyncStatus />)
    expect(await screen.findByText(label)).toBeInTheDocument()
    expect(screen.queryByText('Up to date')).not.toBeInTheDocument()
    expect(screen.getByText(/No successful sync yet/)).toBeInTheDocument()
  })

  it('surfaces a failed sync and retains the last successful timestamp', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([{ ...account, status: 'failed', error: 'Reconnect this mailbox and try again.' }]))
    render(<EmailSyncStatus />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect this mailbox and try again.')
    expect(screen.getByText(/Last successful sync/).querySelector('time')).toHaveAttribute('dateTime', account.lastSyncAt)
    expect(screen.getByRole('button', { name: 'Sync Gmail now' })).toBeEnabled()
  })

  it('queues the selected mailbox provider and does not claim it completed', async () => {
    const outlook = { ...account, id: 'ms-1', email: 'rep@outlook.invalid', provider: 'microsoft' }
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response([account, outlook])).mockResolvedValueOnce(response({ accountId: 'ms-1', status: 'queued' })).mockResolvedValue(response([account, { ...outlook, status: 'queued' }]))
    render(<EmailSyncStatus />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sync Microsoft 365 now' }))
    await waitFor(() => expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const post = request.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({ provider: 'microsoft' })
    expect(await screen.findByRole('status')).toHaveTextContent('Sync queued')
  })

  it('shows a queue request failure with an enabled retry button', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response([account])).mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Unable to queue sync. Try again.' } }) } as Response)
    render(<EmailSyncStatus />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sync Gmail now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to queue sync. Try again.')
    expect(screen.getByRole('button', { name: 'Sync Gmail now' })).toBeEnabled()
  })

  it.each([['page', false, true], ['server', true, false]])('hides mutation controls for %s read-only access', async (_source, canWrite, serverCanWrite) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([account], serverCanWrite))
    render(<EmailSyncStatus canWrite={canWrite} />)
    await screen.findByText('rep@example.invalid')
    expect(screen.queryByRole('button', { name: /Sync .* now/ })).not.toBeInTheDocument()
  })

  it('explains disconnected and unconfigured states', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response([])).mockResolvedValue(response([{ ...account, automatic: false }]))
    render(<EmailSyncStatus />)
    expect(await screen.findByText(/Connect Gmail or Microsoft 365/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh sync status' }))
    expect(await screen.findByText(/Automatic checks are unavailable/)).toBeInTheDocument()
    expect(request.mock.calls).toHaveLength(2)
  })

  it('shows a loading state and permits retry after a status request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network')).mockResolvedValue(response([account]))
    render(<EmailSyncStatus />)
    expect(screen.getByText('Loading sync status…')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load mailbox sync status.')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh sync status' }))
    expect(await screen.findByText('rep@example.invalid')).toBeInTheDocument()
  })

  it('polls only visible pages and stops polling after unmount', async () => {
    vi.useFakeTimers()
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([account]))
    const view = render(<EmailSyncStatus />)
    await act(async () => {})
    expect(request.mock.calls).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(request.mock.calls).toHaveLength(2)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(request.mock.calls).toHaveLength(2)
    view.unmount()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(request.mock.calls).toHaveLength(2)
  })
})
