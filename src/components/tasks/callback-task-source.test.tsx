import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CallbackTaskSource } from './callback-task-source'
const taskId = '11111111-1111-4111-8111-111111111111', callbackId = '22222222-2222-4222-8222-222222222222'
describe('receipt-backed callback source', () => {
  it('loads only on request and links only to the server-verified callback', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { taskId, callbackId } }) }); vi.stubGlobal('fetch', fetch)
    render(<CallbackTaskSource taskId={taskId} />); expect(fetch).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Show callback source' }))
    expect(await screen.findByRole('link', { name: 'Open source callback' })).toHaveAttribute('href', `/settings?section=receptionist&callback=${callbackId}`)
  })
  it('does not trust a response for another task', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { taskId: callbackId, callbackId } }) }))
    render(<CallbackTaskSource taskId={taskId} />); fireEvent.click(screen.getByRole('button', { name: 'Show callback source' })); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull()
  })
})
