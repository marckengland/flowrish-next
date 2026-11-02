import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeLibrary } from './knowledge-library'

const documentId = '49a92f81-0c90-4bf3-971d-1ce39ca77b20'
const rehearsalId = '39a92f81-0c90-4bf3-971d-1ce39ca77b20'
const rehearsalUrl = `/settings?section=receptionist&rehearsal=${rehearsalId}`
const doc = { id: documentId, title: 'Fees FAQ', category: 'FAQ', contentText: 'Question: How much?\n\nAnswer:\n', revision: 1, sourceName: null, sourceMime: null, publishedTitle: null, publishedCategory: null, publishedText: null, publishedRevision: null, publishedAt: null, receptionistApprovedRevision: null, archivedAt: null }
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) } as Response)

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('protects unsaved FAQ edits from the rehearsal backlink until the draft is explicitly saved', async () => {
  const request = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/knowledge') return ok([doc])
    if (url.endsWith('/rehearsal')) return ok({ rehearsalId, title: 'Fees rehearsal', messageIndex: 0, rehearsalUrl })
    return ok(options?.method === 'PATCH' ? { ...doc, contentText: 'Keep my edited answer', revision: 2 } : doc)
  })
  vi.stubGlobal('fetch', request)
  render(<KnowledgeLibrary initialDocumentId={documentId} />)
  expect(await screen.findByRole('link', { name: 'Open rehearsal: Fees rehearsal' })).toHaveAttribute('href', rehearsalUrl)
  fireEvent.change(screen.getByLabelText('Document text'), { target: { value: 'Keep my edited answer' } })
  expect(screen.queryByRole('link', { name: 'Open rehearsal: Fees rehearsal' })).not.toBeInTheDocument()
  const source = screen.getByRole('button', { name: 'Open rehearsal: Fees rehearsal' })
  expect(source).toBeDisabled()
  fireEvent.click(source)
  expect(screen.getByLabelText('Document text')).toHaveValue('Keep my edited answer')
  expect(screen.getByLabelText('Document text')).toBeEnabled()
  expect(screen.getByText(/save draft before opening.*rehearsal/i)).toBeInTheDocument()
  expect(request.mock.calls.some(call => call[1]?.method === 'PATCH')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  expect(await screen.findByRole('link', { name: 'Open rehearsal: Fees rehearsal' })).toHaveAttribute('href', rehearsalUrl)
  expect(screen.getByLabelText('Document text')).toHaveValue('Keep my edited answer')
})
