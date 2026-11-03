import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationInbox } from './notification-inbox'
const key = 'a'.repeat(64), time = '2026-11-03T00:00:00.000Z', callbackId = '11111111-1111-4111-8111-111111111111', taskId = '22222222-2222-4222-8222-222222222222'
const row = { key, kind: 'overdue', callbackId, taskId, dueDate: time, createdAt: time, readAt: null }
const fetch = vi.fn(), result = (rows: unknown[], page = 1, hasMore = false) => ({ ok: true, json: async () => ({ data: { rows, page, hasMore } }) })
beforeEach(() => { fetch.mockReset(); vi.stubGlobal('fetch', fetch); fetch.mockResolvedValue(result([row])) })
describe('notification inbox', () => {
  it('drops stale actions when current access or work is no longer available', async () => {
    render(<NotificationInbox />); const read = await screen.findByRole('button', { name: 'Mark read' }); fetch.mockResolvedValueOnce({ ok: false, status: 404 }); fireEvent.click(read); expect(await screen.findByRole('alert')).toHaveTextContent('no longer available'); expect(screen.queryByRole('link', { name: 'Open callback task' })).toBeNull(); await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh notifications' })).toBeEnabled())
  })
  it('loads without writes and requires an explicit retryable mark-read action', async () => {
    render(<NotificationInbox />); const read = await screen.findByRole('button', { name: 'Mark read' }); expect(fetch).toHaveBeenCalledTimes(1); expect(screen.getByRole('link', { name: 'Open callback task' })).toHaveAttribute('href', `/tasks/${taskId}`)
    fetch.mockResolvedValueOnce({ ok: false, status: 503 }); fireEvent.click(read); await screen.findByRole('alert'); expect(screen.queryByText('private SQL')).toBeNull(); await waitFor(() => expect(screen.getByRole('button', { name: 'Mark read' })).toBeEnabled())
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { key, readAt: time } }) }).mockResolvedValueOnce(result([])); fireEvent.click(screen.getByRole('button', { name: 'Mark read' })); await screen.findByText('No notifications in this view.'); expect(fetch.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(2); expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ read: true })
  })
  it('supports unread/all pagination and rejects stale or malformed rows safely', async () => {
    fetch.mockResolvedValueOnce(result([row], 1, true)); render(<NotificationInbox />); await screen.findByRole('button', { name: 'Mark read' }); fetch.mockResolvedValueOnce(result([], 2)); fireEvent.click(screen.getByRole('button', { name: 'Next page' })); await screen.findByText('Showing unread · Page 2'); expect(String(fetch.mock.calls[1][0])).toContain('page=2')
    fetch.mockResolvedValueOnce(result([{ ...row, readAt: time }], 1)); fireEvent.change(screen.getByRole('combobox', { name: 'Notification filter' }), { target: { value: 'all' } }); await screen.findByText('Showing all · Page 1'); expect(screen.queryByRole('button', { name: 'Mark read' })).toBeNull()
    fetch.mockResolvedValueOnce(result([{ ...row, taskId: 'https://evil.example', kind: '<img src=x>' }])); fireEvent.click(screen.getByRole('button', { name: 'Refresh notifications' })); await screen.findByRole('alert'); expect(screen.queryByRole('link', { name: 'Open callback task' })).toBeNull()
  })
})
