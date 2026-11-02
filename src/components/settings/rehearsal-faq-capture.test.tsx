import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RehearsalReport } from '@/lib/receptionist-rehearsal'
import { ReceptionistRehearsalReports } from './receptionist-rehearsal-reports'

const report: RehearsalReport = {
  id: '39a92f81-0c90-4bf3-971d-1ce39ca77b20', title: 'Fees rehearsal', createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', verdict: 'needs_work', notes: '', unansweredMessageIndexes: [0],
  snapshot: { clientId: '13992f81-0c90-4bf3-971d-1ce39ca77b20', settingsVersion: '2026-11-01T00:00:00.000Z', finished: false, messages: [{ role: 'caller', content: 'How much?', generation: 'scripted', sources: [] }, { role: 'caller', content: 'When are you open?', generation: 'scripted', sources: [] }] },
}
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

describe('FAQ actions on saved rehearsal gaps', () => {
  it('shows actions only for saved flagged questions and requires saving every local review field first', async () => {
    const request = vi.fn().mockResolvedValueOnce(ok(report)).mockResolvedValueOnce(ok({ ...report, notes: 'Check fees', unansweredMessageIndexes: [0, 1] }))
    vi.stubGlobal('fetch', request)
    render(<ReceptionistRehearsalReports snapshot={report.snapshot} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save rehearsal' }))
    await screen.findByText('Rehearsal saved.')
    expect(screen.getAllByRole('button', { name: 'Create FAQ draft' })).toHaveLength(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Review notes' }), { target: { value: 'Check fees' } })
    expect(screen.getByRole('button', { name: 'Create FAQ draft' })).toBeDisabled()
    expect(screen.getByText(/save review first/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /caller message 2/ }))
    expect(screen.getAllByRole('button', { name: 'Create FAQ draft' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))
    await screen.findByText('Review saved.')
    expect(screen.getAllByRole('button', { name: 'Create FAQ draft' })).toHaveLength(2)
    for (const button of screen.getAllByRole('button', { name: 'Create FAQ draft' })) expect(button).toBeEnabled()
  })
  it('opens an exact linked report without fetching history or starting preview', async () => {
    window.history.replaceState({}, '', `/settings?section=receptionist&rehearsal=${report.id}`)
    const request = vi.fn().mockResolvedValue(ok(report))
    vi.stubGlobal('fetch', request)
    render(<ReceptionistRehearsalReports snapshot={null} disabled={false} />)
    await screen.findByRole('heading', { name: 'Fees rehearsal' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe(`/api/admin/receptionist/rehearsals/${report.id}`)
    expect(request.mock.calls[0][1].method).toBe('GET')
  })
  it('ignores malformed and duplicate report query values', () => {
    window.history.replaceState({}, '', `/settings?section=receptionist&rehearsal=${report.id}&rehearsal=${report.id}`)
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    render(<ReceptionistRehearsalReports snapshot={null} disabled={false} />)
    expect(request).not.toHaveBeenCalled()
  })
})
