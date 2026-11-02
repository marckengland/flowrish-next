import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RehearsalReport, RehearsalSnapshot } from '@/lib/receptionist-rehearsal'
import { ReceptionistRehearsalReports } from './receptionist-rehearsal-reports'

const snapshot: RehearsalSnapshot = {
  clientId: '13992f81-0c90-4bf3-971d-1ce39ca77b20', settingsVersion: '2026-11-01T00:00:00.000Z', finished: false,
  messages: [
    { role: 'caller', content: 'How much is a consultation?', generation: 'scripted', sources: [] },
    { role: 'receptionist', content: 'Consultations cost 500 pesos.', generation: 'ai', sources: [{ id: '29219f81-0c90-4bf3-971d-1ce39ca77b20', title: 'Consultation fees', revision: 3 }] },
  ],
}
const report: RehearsalReport = {
  id: '39a92f81-0c90-4bf3-971d-1ce39ca77b20', title: 'Pricing rehearsal', snapshot,
  createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z',
  verdict: 'unreviewed', notes: '', unansweredMessageIndexes: [],
}
const response = (data: unknown) => ({ ok: true, json: async () => ({ data }) })

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('saved browser rehearsal reports', () => {
  it('makes no automatic requests and enables history without a draft snapshot', async () => {
    const fetch = vi.fn().mockResolvedValue(response([]))
    vi.stubGlobal('fetch', fetch)
    render(<ReceptionistRehearsalReports snapshot={null} disabled={false} />)
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save rehearsal' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Load saved rehearsals' }))
    await screen.findByText(/No saved rehearsals/)
    expect(fetch).toHaveBeenCalledWith('/api/admin/receptionist/rehearsals', expect.objectContaining({ method: 'GET', cache: 'no-store' }))
  })

  it('saves only on demand, preserves the title and prevents another save of the same clientId', async () => {
    const fetch = vi.fn().mockResolvedValue(response(report))
    vi.stubGlobal('fetch', fetch)
    render(<ReceptionistRehearsalReports snapshot={snapshot} disabled={false} />)
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Rehearsal title' }), { target: { value: 'Pricing rehearsal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rehearsal' }))
    await screen.findByText('Rehearsal saved.')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ title: 'Pricing rehearsal', snapshot })
    expect(fetch.mock.calls[0][1].method).toBe('POST')
    expect(screen.getByRole('textbox', { name: 'Rehearsal title' })).toHaveValue('Pricing rehearsal')
    expect(screen.getByRole('button', { name: 'Save rehearsal' })).toBeDisabled()
    expect(screen.getByText(/admin-submitted/i)).toBeInTheDocument()
  })

  it('shows the saved source revision and sends only caller knowledge gaps with the manual review', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(report)).mockResolvedValueOnce(response({ ...report, verdict: 'needs_work', notes: 'Check fees', unansweredMessageIndexes: [0] }))
    vi.stubGlobal('fetch', fetch)
    render(<ReceptionistRehearsalReports snapshot={snapshot} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save rehearsal' }))
    await screen.findByText('Rehearsal saved.')
    expect(screen.getByText(/Consultation fees/)).toHaveTextContent(/revision 3/i)
    expect(screen.queryByText(/29219f81/)).not.toBeInTheDocument()
    expect(screen.getByText(/Manual FAQs may also have been available/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /knowledge library/i })).toHaveAttribute('href', '/knowledge')
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.click(screen.getByRole('checkbox', { name: /Needs knowledge/ }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Manual review verdict' }), { target: { value: 'needs_work' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Review notes' }), { target: { value: 'Check fees' } })
    expect(screen.getByRole('textbox', { name: 'Review notes' })).toHaveAttribute('maxLength', '2000')
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))
    await screen.findByText('Review saved.')
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ verdict: 'needs_work', notes: 'Check fees', unansweredMessageIndexes: [0], expectedUpdatedAt: report.updatedAt })
    expect(fetch.mock.calls[1][1].method).toBe('PATCH')
    expect(screen.getByText(/Generation: ai/i)).toBeInTheDocument()
  })

  it('keeps local review edits on conflict until the user explicitly reloads', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(report)).mockResolvedValueOnce({ ok: false, status: 409 }).mockResolvedValueOnce(response({ ...report, notes: 'Latest reviewer note' }))
    vi.stubGlobal('fetch', fetch)
    render(<ReceptionistRehearsalReports snapshot={snapshot} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save rehearsal' }))
    await screen.findByText('Rehearsal saved.')
    fireEvent.change(screen.getByRole('textbox', { name: 'Review notes' }), { target: { value: 'Keep my draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('textbox', { name: 'Review notes' })).toHaveValue('Keep my draft')
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest rehearsal' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Review notes' })).toHaveValue('Latest reviewer note'))
  })

  it('retries a failed explicit save with the same clientId and never displays server errors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'private database detail' }) }).mockResolvedValueOnce(response(report))
    vi.stubGlobal('fetch', fetch)
    render(<ReceptionistRehearsalReports snapshot={snapshot} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save rehearsal' }))
    await screen.findByRole('alert')
    expect(screen.queryByText(/private database/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Rehearsal saved.')
    expect(JSON.parse(fetch.mock.calls[1][1].body).snapshot.clientId).toBe(snapshot.clientId)
  })

  it('requires a separate delete confirmation and removes the saved detail and history item', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response([report])).mockResolvedValueOnce(response(report)).mockResolvedValueOnce(response({ deleted: true }))
    vi.stubGlobal('fetch', fetch)
    render(<ReceptionistRehearsalReports snapshot={null} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load saved rehearsals' }))
    fireEvent.click(await screen.findByRole('button', { name: /Open Pricing rehearsal/ }))
    await screen.findByRole('textbox', { name: 'Review notes' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete saved rehearsal' }))
    expect(fetch).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }))
    expect(screen.queryByRole('button', { name: 'Confirm deletion' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete saved rehearsal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }))
    await screen.findByText('Rehearsal deleted.')
    expect(fetch.mock.calls[2][1].method).toBe('DELETE')
    expect(screen.queryByRole('textbox', { name: 'Review notes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open Pricing rehearsal/ })).not.toBeInTheDocument()
  })

  it('clears the previous detail while opening another and ignores out-of-order detail responses', async () => {
    const other = { ...report, id: '49a92f81-0c90-4bf3-971d-1ce39ca77b20', title: 'Other rehearsal', snapshot: { ...snapshot, messages: [{ role: 'caller', content: 'Other question', generation: 'scripted', sources: [] }] } }
    let finish!: (value: unknown) => void
    const fetch = vi.fn().mockResolvedValueOnce(response([report, other])).mockResolvedValueOnce(response(report)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(response(other))
    vi.stubGlobal('fetch', fetch)
    render(<ReceptionistRehearsalReports snapshot={null} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load saved rehearsals' }))
    fireEvent.click(await screen.findByRole('button', { name: /Open Pricing rehearsal/ }))
    await screen.findByText('Consultations cost 500 pesos.')
    fireEvent.click(screen.getByRole('button', { name: /Open Pricing rehearsal/ }))
    expect(screen.queryByText('Consultations cost 500 pesos.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Open Other rehearsal/ }))
    await screen.findByText('Other question')
    await act(async () => { finish(response(report)) })
    expect(screen.queryByText('Consultations cost 500 pesos.')).not.toBeInTheDocument()
  })

  it('aborts requests and ignores their result when the draft changes or component unmounts', async () => {
    let finish!: (value: unknown) => void
    const fetch = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetch)
    const { rerender, unmount } = render(<ReceptionistRehearsalReports snapshot={snapshot} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save rehearsal' }))
    const signal = fetch.mock.calls[0][1].signal
    rerender(<ReceptionistRehearsalReports snapshot={{ ...snapshot, clientId: '59a92f81-0c90-4bf3-971d-1ce39ca77b20' }} disabled={false} />)
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(response(report)) })
    expect(screen.queryByText('Rehearsal saved.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save rehearsal' }))
    const nextSignal = fetch.mock.calls[1][1].signal
    unmount()
    expect(nextSignal.aborted).toBe(true)
  })

  it('retries a failed review with the latest local edits', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(report)).mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValueOnce(response({ ...report, notes: 'Revised note' }))
    vi.stubGlobal('fetch', fetch)
    render(<ReceptionistRehearsalReports snapshot={snapshot} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save rehearsal' }))
    await screen.findByText('Rehearsal saved.')
    fireEvent.change(screen.getByRole('textbox', { name: 'Review notes' }), { target: { value: 'First note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))
    await screen.findByRole('alert')
    fireEvent.change(screen.getByRole('textbox', { name: 'Review notes' }), { target: { value: 'Revised note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Review saved.')
    expect(JSON.parse(fetch.mock.calls[2][1].body).notes).toBe('Revised note')
  })

  it('cleans up a deleted rehearsal when a lost response is retried and returns not found', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(report))
      .mockResolvedValueOnce(response([report]))
      .mockRejectedValueOnce(new Error('Response lost'))
      .mockResolvedValueOnce({ ok: false, status: 404 })
    vi.stubGlobal('fetch', fetch)
    render(<ReceptionistRehearsalReports snapshot={snapshot} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save rehearsal' }))
    await screen.findByText('Rehearsal saved.')
    fireEvent.click(screen.getByRole('button', { name: 'Load saved rehearsals' }))
    await screen.findByRole('button', { name: /Open Pricing rehearsal/ })
    fireEvent.click(screen.getByRole('button', { name: 'Delete saved rehearsal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('textbox', { name: 'Review notes' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Rehearsal deleted.')
    expect(fetch.mock.calls[2][1].method).toBe('DELETE')
    expect(fetch.mock.calls[3][1].method).toBe('DELETE')
    expect(screen.queryByRole('textbox', { name: 'Review notes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open Pricing rehearsal/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save rehearsal' })).toBeEnabled()
  })

  it('disables operations when settings or preview are busy', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<ReceptionistRehearsalReports snapshot={snapshot} disabled />)
    expect(screen.getByRole('button', { name: 'Save rehearsal' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Load saved rehearsals' })).toBeDisabled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
