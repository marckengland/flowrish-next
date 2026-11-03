import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseTargetQueue } from './response-target-queue'
const id = '11111111-1111-4111-8111-111111111111', task = '22222222-2222-4222-8222-222222222222', stamp = '2026-11-03T00:00:00.000Z'
const fetch = vi.fn(), ok = (rows: unknown[], page = 1) => ({ ok: true, json: async () => ({ data: { rows, page, hasMore: page === 1, policyEnabled: true } }) })
beforeEach(() => { fetch.mockReset(); vi.stubGlobal('fetch', fetch) })
describe('response target queue', () => {
  it('shows phase/deadline/owner and approved actions without creating CRM work or outcomes', async () => {
    fetch.mockResolvedValueOnce(ok([{ callbackId: id, phase: 'attempt', startedAt: stamp, dueAt: stamp, taskId: task, assigneeName: '<img src=x>', missed: true }])); render(<ResponseTargetQueue />); expect(await screen.findByText('First contact target missed')).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Open callback task' })).toHaveAttribute('href', `/tasks/${task}`); expect(screen.getByText('<img src=x>')).toBeInTheDocument(); expect(document.querySelector('img')).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].method).toBeUndefined()
    fetch.mockResolvedValueOnce(ok([], 2)); fireEvent.click(screen.getByRole('button', { name: 'Next page' })); await screen.findByText('Showing missed · Page 2'); expect(screen.getByText('No response targets in this view.')).toBeInTheDocument()
  })
  it('rejects malformed or stale target responses and exposes a retry without private diagnostics', async () => {
    fetch.mockResolvedValueOnce(ok([{ callbackId: id, phase: 'attempt', startedAt: stamp, dueAt: stamp, taskId: 'https://evil.example', assigneeName: null, missed: true }])); render(<ResponseTargetQueue />); await screen.findByRole('alert'); expect(screen.queryByRole('link', { name: 'Open callback task' })).toBeNull(); fetch.mockResolvedValueOnce(ok([])); fireEvent.click(screen.getByRole('button', { name: 'Refresh response targets' })); await screen.findByText('No response targets in this view.')
  })
})
