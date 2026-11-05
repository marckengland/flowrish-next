import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation }))
import { DuplicateCheck } from './duplicate-check'
const leadId = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', reviewId = '33333333-3333-4333-8333-333333333333'
const props = { leadId, organizationId: 'org', userId: 'user', canMerge: true }
const counts = { Activity: 2, Task: 1, StageTransition: 0, ScoreHistory: 0, LeadContact: 1 }
const preview = { state: 'preview', id: reviewId, primaryId: leadId, secondaryId: other, primaryLabel: 'Current Practice', secondaryLabel: 'Other Practice', expiresAt: '2099-01-01T00:00:00.000Z', fields: [{ key: 'email', label: 'Email', primary: 'keep@example.invalid', secondary: 'archive@example.invalid', different: true }], counts, blockers: [] }
function response(data: unknown) { return new Response(JSON.stringify({ data, scope: { organizationId: 'org', userId: 'user' } })) }
function mount(canMerge = true) { return render(<QueryClientProvider client={new QueryClient()}><DuplicateCheck {...props} canMerge={canMerge} /></QueryClientProvider>) }
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', vi.fn()); vi.spyOn(crypto, 'randomUUID').mockReturnValue(reviewId) })
async function search() { vi.mocked(fetch).mockResolvedValueOnce(response([{ leadId: other, leadName: 'Other Practice', matchType: 'email', matchValue: 'practice@example.invalid' }])); fireEvent.click(screen.getByRole('button', { name: 'Check for duplicates' })); await screen.findByLabelText('Choose duplicate Other Practice'); fireEvent.click(screen.getByLabelText('Choose duplicate Other Practice')) }
async function prepare(blockers: string[] = []) { vi.mocked(fetch).mockResolvedValueOnce(response({ ...preview, blockers })); fireEvent.click(screen.getByRole('button', { name: 'Preview merge' })); await screen.findByText('archive@example.invalid') }
it('makes no automatic requests, previews both records and requires explicit confirmation before applying', async () => {
  mount(); expect(fetch).not.toHaveBeenCalled(); await search(); expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ leadId }); await prepare(); expect(screen.getByRole('button', { name: 'Confirm merge' })).toBeDisabled(); expect(fetch).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByLabelText('I reviewed the retained fields, transfers, and archived record')); vi.mocked(fetch).mockResolvedValueOnce(response({ state: 'applied', id: reviewId, primaryId: leadId, secondaryId: other, counts, appliedAt: '2026-11-05T00:00:00.000Z' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' })); await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/leads/${leadId}`)); expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body))).toEqual({ id: reviewId, confirmed: true })
})
it('blocks workflow-linked merges and hides merge controls without delete permission', async () => {
  const first = mount(); await search(); await prepare(['Secondary has callback work.']); expect(screen.getByRole('button', { name: 'Confirm merge' })).toBeDisabled(); expect(screen.getByText('Secondary has callback work.')).toBeInTheDocument(); expect(fetch).toHaveBeenCalledTimes(2); first.unmount(); mount(false); await search(); expect(screen.queryByRole('button', { name: 'Preview merge' })).not.toBeInTheDocument()
})
it('explicitly retries a lost response with the same ID and never starts another batch automatically', async () => {
  mount(); await search(); await prepare(); fireEvent.click(screen.getByLabelText('I reviewed the retained fields, transfers, and archived record')); vi.mocked(fetch).mockRejectedValueOnce(new TypeError('lost')); fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' })); await screen.findByRole('button', { name: 'Retry confirmed merge' }); expect(fetch).toHaveBeenCalledTimes(3); expect(screen.getByRole('button', { name: 'Check for duplicates' })).toBeDisabled()
  vi.mocked(fetch).mockResolvedValueOnce(response({ state: 'applied', id: reviewId, primaryId: leadId, secondaryId: other, counts, appliedAt: '2026-11-05T00:00:00.000Z' })); fireEvent.click(screen.getByRole('button', { name: 'Retry confirmed merge' })); await waitFor(() => expect(navigation.push).toHaveBeenCalled()); expect(vi.mocked(fetch).mock.calls[2][1]?.body).toBe(vi.mocked(fetch).mock.calls[3][1]?.body)
})
it('clears an unconfirmed preview when the retained lead changes', async () => {
  mount(); await search(); await prepare(); fireEvent.click(screen.getByLabelText('I reviewed the retained fields, transfers, and archived record')); fireEvent.change(screen.getByLabelText('Lead to keep'), { target: { value: other } }); expect(screen.queryByRole('button', { name: 'Confirm merge' })).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalledTimes(2)
})
it('invalidates prewarmed related-data caches after a successful merge', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 60000 } } })
  const keys = [['activities', 'byLead', leadId], ['tasks', 'lead', leadId], ['tasks', 'list'], ['email-threads', leadId], ['audit-log', 'entity', 'Lead', leadId], ['contacts', 'all', 'min']]
  keys.forEach(key => client.setQueryData(key, ['before merge'])); client.setQueryData(['unrelated'], ['leave alone'])
  render(<QueryClientProvider client={client}><DuplicateCheck {...props} /></QueryClientProvider>); await search(); await prepare(); fireEvent.click(screen.getByLabelText('I reviewed the retained fields, transfers, and archived record')); vi.mocked(fetch).mockResolvedValueOnce(response({ state: 'applied', id: reviewId, primaryId: leadId, secondaryId: other, counts, appliedAt: '2026-11-05T00:00:00.000Z' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' })); await waitFor(() => expect(navigation.push).toHaveBeenCalled())
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  expect(client.getQueryState(['unrelated'])?.isInvalidated).toBe(false)
})
