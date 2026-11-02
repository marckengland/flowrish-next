import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeRehearsalOrigin } from './knowledge-rehearsal-origin'

const documentId = '49a92f81-0c90-4bf3-971d-1ce39ca77b20'
const rehearsalId = '39a92f81-0c90-4bf3-971d-1ce39ca77b20'
const origin = { rehearsalId, title: 'Fees review', messageIndex: 0, rehearsalUrl: `/settings?section=receptionist&rehearsal=${rehearsalId}` }
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('knowledge rehearsal origin', () => {
  it('loads metadata only on request and links to the exact report for a manual retest', async () => {
    const request = vi.fn().mockResolvedValue(ok(origin))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeRehearsalOrigin documentId={documentId} />)
    expect(request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'View rehearsal source' }))
    expect(await screen.findByRole('link', { name: /open.*fees review/i })).toHaveAttribute('href', origin.rehearsalUrl)
    expect(request.mock.calls[0][0]).toBe(`/api/knowledge/${documentId}/rehearsal`)
    expect(screen.getByText(/start browser preview/i)).toBeInTheDocument()
  })
  it('autoloads only when requested and explains a missing source', async () => {
    const request = vi.fn().mockResolvedValue(ok(null))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeRehearsalOrigin documentId={documentId} autoLoad />)
    expect(await screen.findByText(/no saved rehearsal source/i)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
  it('ignores stale metadata and rejects a mismatched backlink', async () => {
    let finish!: (value: unknown) => void
    const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(ok({ ...origin, rehearsalUrl: '/settings' }))
    vi.stubGlobal('fetch', request)
    const { rerender } = render(<KnowledgeRehearsalOrigin documentId={documentId} autoLoad />)
    const signal = request.mock.calls[0][1].signal
    rerender(<KnowledgeRehearsalOrigin documentId={rehearsalId} autoLoad />)
    expect(signal.aborted).toBe(true)
    await screen.findByRole('alert')
    await act(async () => { finish(ok(origin)) })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
