import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { KanbanBoard } from './kanban-board'
import type { LeadListItem } from '@/hooks/use-leads'
const stages = [{ id: 'new', name: 'New', order: 1, isClosedWon: false, isClosedLost: false }, { id: 'won', name: 'Won', order: 2, isClosedWon: true, isClosedLost: false }]
const lead = { id: 'lead', firstName: 'Practice', lastName: 'Prospect', stageId: 'new', currency: 'USD', dealValue: 100, score: 50, stage: stages[0] } as LeadListItem
const page = { data: [lead], pagination: { page: 1, pageSize: 200, total: 1, totalPages: 1 } }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } }); render(<QueryClientProvider client={client}><KanbanBoard stages={stages} initialLeads={[lead]} totalLeads={1} canMove pipelineId="pipeline" /></QueryClientProvider>); return client }
it('pins board refreshes to its pipeline and prevents repeated moves while a save is pending', async () => {
  let finish!: (value: Response) => void
  const request = vi.fn().mockImplementation(async (_url, init) => init?.method === 'PATCH' ? new Promise(resolve => { finish = resolve }) : Response.json(page))
  vi.stubGlobal('fetch', request); mount()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'won' } })
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(screen.getByRole('combobox')).toBeDisabled()
  await act(async () => { finish(Response.json({ data: { stageId: 'won' } })) })
  await waitFor(() => expect(request.mock.calls.some(call => String(call[0]).includes('pipelineId=pipeline'))).toBe(true))
  expect(request.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(1)
})
it('shows failed refreshes and prevents writes from the stale board until an explicit read succeeds', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 503 })))
  const client = mount()
  await act(async () => { await client.invalidateQueries() })
  expect(await screen.findByText(/Couldn.t refresh pipeline/)).toBeVisible()
  expect(screen.getByRole('combobox')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Refresh pipeline' })).toBeVisible()
})
