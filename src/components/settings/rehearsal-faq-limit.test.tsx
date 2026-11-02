import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RehearsalFaqAction } from './rehearsal-faq-action'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('explains a full knowledge library using static guidance without exposing the server message', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 'KNOWLEDGE_LIMIT', message: 'untrusted private server detail' } }) }))
  render(<RehearsalFaqAction rehearsalId="39a92f81-0c90-4bf3-971d-1ce39ca77b20" messageIndex={0} expectedUpdatedAt="2026-11-02T00:00:00.000Z" disabled={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Create FAQ draft' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('The knowledge library is full. Archive a document before creating another FAQ draft.')
  expect(screen.queryByText(/untrusted private server detail/)).not.toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})
