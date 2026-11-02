import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReceptionistChecklist } from '@/lib/receptionist-checklist'
import { ReceptionistReadinessChecklist } from './receptionist-readiness-checklist'

const checklist: ReceptionistChecklist = {
  scope: 'saved_setup', checkedAt: '2026-11-02T10:00:00.000Z', settingsVersion: 'saved-1',
  checks: [
    { id: 'business', label: 'Business name', status: 'complete', detail: 'A business name is saved.' },
    { id: 'hours', label: 'Business hours', status: 'complete', detail: 'Business hours are saved.' },
    { id: 'knowledge', label: 'Approved knowledge', status: 'attention', detail: 'Add approved knowledge.' },
    { id: 'callbacks', label: 'Callback routing', status: 'complete', detail: 'A callback owner and open stage are saved.' },
    { id: 'ai', label: 'AI configuration', status: 'attention', detail: 'AI configuration needs attention.' },
  ],
}

function response(data: unknown = { data: checklist }, ok = true) {
  return { ok, json: async () => data } as Response
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('saved receptionist setup checklist', () => {
  it('waits for an explicit check and explains its presence-only scope', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response())
    render(<ReceptionistReadinessChecklist hasUnsavedChanges={false} />)

    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Check readiness' })).toBeEnabled()
    expect(screen.getByText('Saved setup has not been checked.')).toBeInTheDocument()
    expect(screen.getByText(/presence only/i)).toHaveTextContent(/business facts.*live AI.*billing.*phone routing/i)
  })

  it('disables checks while settings have unsaved changes', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response())
    render(<ReceptionistReadinessChecklist hasUnsavedChanges />)

    const button = screen.getByRole('button', { name: 'Check readiness' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('Save your receptionist settings before checking readiness.')
    fireEvent.click(button)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows the saved check count and accessible complete or attention statuses', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response())
    render(<ReceptionistReadinessChecklist hasUnsavedChanges={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check readiness' }))

    expect(await screen.findByText('3 of 5 saved setup checks complete')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Saved setup checks' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    expect(within(list).getAllByText('Complete')).toHaveLength(3)
    expect(within(list).getAllByText('Needs attention')).toHaveLength(2)
    expect(screen.getByText('Add approved knowledge.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/admin/receptionist/checklist', {
      method: 'GET', cache: 'no-store', signal: expect.any(AbortSignal),
    })
    expect(screen.getByText(/connections remain unverified/i)).toBeInTheDocument()
  })

  it.each(['http', 'network', 'invalid body'])('shows a safe error and permits an explicit retry after a %s error', async (kind) => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    if (kind === 'network') fetch.mockRejectedValueOnce(new Error('secret-value'))
    else fetch.mockResolvedValueOnce(response(kind === 'http' ? { error: { message: 'secret-value' } } : null, kind !== 'http'))
    fetch.mockResolvedValueOnce(response())
    render(<ReceptionistReadinessChecklist hasUnsavedChanges={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check readiness' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check saved setup. Please try again.')
    expect(screen.queryByText(/secret-value/)).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Check readiness' }))
    expect(await screen.findByText('3 of 5 saved setup checks complete')).toBeInTheDocument()
  })

  it('disables duplicate checks while a request is pending', async () => {
    let resolve!: (value: Response) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise((done) => { resolve = done }))
    render(<ReceptionistReadinessChecklist hasUnsavedChanges={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check readiness' }))

    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Checking saved setup…')
    await act(async () => { resolve(response()) })
    expect(screen.getByRole('button', { name: 'Check readiness' })).toBeEnabled()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('aborts a check and ignores its late response after unsaved changes', async () => {
    let resolve!: (value: Response) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise((done) => { resolve = done }))
    const { rerender } = render(<ReceptionistReadinessChecklist hasUnsavedChanges={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check readiness' }))
    const signal = fetch.mock.calls[0][1]?.signal
    rerender(<ReceptionistReadinessChecklist hasUnsavedChanges />)

    expect(signal?.aborted).toBe(true)
    await act(async () => { resolve(response()) })
    expect(screen.queryByText('3 of 5 saved setup checks complete')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check readiness' })).toBeDisabled()
  })

  it('aborts a request on unmount and ignores its late rejection', async () => {
    let reject!: (error: Error) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
    const { unmount } = render(<ReceptionistReadinessChecklist hasUnsavedChanges={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check readiness' }))
    const signal = fetch.mock.calls[0][1]?.signal
    unmount()

    expect(signal?.aborted).toBe(true)
    await act(async () => { reject(new Error('secret-value')) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
