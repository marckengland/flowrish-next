import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RehearsalFaqAction } from './rehearsal-faq-action'

const rehearsalId = '39a92f81-0c90-4bf3-971d-1ce39ca77b20'
const documentId = '49a92f81-0c90-4bf3-971d-1ce39ca77b20'
const props = { rehearsalId, messageIndex: 0, expectedUpdatedAt: '2026-11-02T00:00:00.000Z', disabled: false }
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('rehearsal FAQ draft action', () => {
  it('creates only on click using the saved index and version, then offers the validated editor link', async () => {
    const request = vi.fn().mockResolvedValue(ok({ documentId, knowledgeUrl: `/knowledge?document=${documentId}`, created: true }))
    vi.stubGlobal('fetch', request)
    render(<RehearsalFaqAction {...props} />)
    expect(request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create FAQ draft' }))
    expect(await screen.findByRole('link', { name: 'Open FAQ draft' })).toHaveAttribute('href', `/knowledge?document=${documentId}`)
    expect(request.mock.calls[0][0]).toBe(`/api/admin/receptionist/rehearsals/${rehearsalId}/faq`)
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ messageIndex: 0, expectedUpdatedAt: props.expectedUpdatedAt })
    expect(screen.getByText(/write.*answer.*review/i)).toBeInTheDocument()
  })
  it('blocks disabled actions and explains stale reviews without leaking server details', async () => {
    const request = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'private detail' }) })
    vi.stubGlobal('fetch', request)
    const { rerender } = render(<RehearsalFaqAction {...props} disabled />)
    expect(screen.getByRole('button')).toBeDisabled()
    rerender(<RehearsalFaqAction {...props} />)
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/reload.*review/i)
    expect(screen.queryByText(/private detail/)).not.toBeInTheDocument()
  })
  it('rejects unsafe links and allows an explicit retry', async () => {
    const request = vi.fn().mockResolvedValueOnce(ok({ documentId, knowledgeUrl: 'https://evil.example/', created: true })).mockResolvedValueOnce(ok({ documentId, knowledgeUrl: `/knowledge?document=${documentId}`, created: false }))
    vi.stubGlobal('fetch', request)
    render(<RehearsalFaqAction {...props} />)
    fireEvent.click(screen.getByRole('button'))
    await screen.findByRole('alert')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByRole('link', { name: 'Open FAQ draft' })).toHaveAttribute('href', `/knowledge?document=${documentId}`)
  })
  it('aborts and ignores a response after the selected saved review changes', async () => {
    let finish!: (value: unknown) => void
    const request = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', request)
    const { rerender, unmount } = render(<RehearsalFaqAction {...props} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toBeDisabled()
    const signal = request.mock.calls[0][1].signal
    rerender(<RehearsalFaqAction {...props} messageIndex={2} />)
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(ok({ documentId, knowledgeUrl: `/knowledge?document=${documentId}`, created: true })) })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    unmount()
    expect(request.mock.calls[1][1].signal.aborted).toBe(true)
  })
})
