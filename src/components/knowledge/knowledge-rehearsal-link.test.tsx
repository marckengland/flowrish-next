import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeLibrary } from './knowledge-library'

const id = '49a92f81-0c90-4bf3-971d-1ce39ca77b20'
const doc = { id, title: 'Question draft', category: 'FAQ', contentText: 'Question: How much?\n\nAnswer:\n', revision: 1, sourceName: null, sourceMime: null, publishedTitle: null, publishedCategory: null, publishedText: null, publishedRevision: null, publishedAt: null, receptionistApprovedRevision: null, archivedAt: null }
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) } as Response)
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('incoming rehearsal FAQ document links', () => {
  it('opens the requested saved document and loads its source without publishing', async () => {
    const request = vi.fn().mockImplementation(async (url: string) => url === '/api/knowledge' ? ok([]) : url.endsWith('/rehearsal') ? ok(null) : ok(doc))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeLibrary initialDocumentId={id} />)
    expect(await screen.findByLabelText('Document text')).toHaveValue('Question: How much?\n\nAnswer:\n')
    await screen.findByText(/no saved rehearsal source/i)
    expect(request.mock.calls.map(call => call[0])).toEqual(['/api/knowledge', `/api/knowledge/${id}`, `/api/knowledge/${id}/rehearsal`])
    fireEvent.change(screen.getByLabelText('Document text'), { target: { value: 'Keep answer edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'New document' }))
    expect(screen.getByRole('region', { name: 'Unsaved draft confirmation' })).toBeInTheDocument()
    expect(screen.getByLabelText('Document text')).toHaveValue('Keep answer edit')
  })
  it('requires an explicit source request when a linked document is later selected through the library', async () => {
    const other = { ...doc, id: '59a92f81-0c90-4bf3-971d-1ce39ca77b20', title: 'Other FAQ' }
    const request = vi.fn().mockImplementation(async (url: string) => url === '/api/knowledge' ? ok([doc, other]) : url.endsWith('/rehearsal') ? ok(null) : ok(url.endsWith(other.id) ? other : doc))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeLibrary initialDocumentId={id} />)
    await screen.findByText(/no saved rehearsal source/i)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Other FAQ' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Other FAQ' }))
    await screen.findByRole('button', { name: 'View rehearsal source' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Question draft' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Question draft' }))
    await screen.findByLabelText('Document text')
    await waitFor(() => expect(screen.getByRole('button', { name: 'View rehearsal source' })).toBeEnabled())
    expect(await screen.findByRole('button', { name: 'View rehearsal source' })).toBeEnabled()
    expect(request.mock.calls.filter(call => String(call[0]).endsWith('/rehearsal'))).toHaveLength(1)
  })
  it('ignores invalid document IDs without additional requests', async () => {
    const request = vi.fn().mockResolvedValue(ok([]))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeLibrary initialDocumentId="https://evil.example" />)
    await screen.findByText(/no documents yet/i)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
