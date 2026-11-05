import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BulkLeadControls } from './bulk-lead-controls'
const id = '11111111-1111-4111-8111-111111111111', userId = '33333333-3333-4333-8333-333333333333'
const selection = [{ id, expectedUpdatedAt: '2026-11-05T00:00:00.000Z' }]
const props = { organizationId: 'org', userId, selection, contextKey: 'page1', onApplied: vi.fn() }
const preview = { state: 'preview', id, expiresAt: '2099-01-01T00:00:00.000Z', change: { field: 'leadStatus', value: 'QUALIFIED' }, targetLabel: 'QUALIFIED', rows: [{ id, label: 'Practice Prospect', before: 'NEW', after: 'QUALIFIED', changed: true }] }
const receipt = { state: 'applied', id, updated: 1, unchanged: 0, appliedAt: '2026-11-05T01:00:00.000Z' }
function response(data: unknown) { return new Response(JSON.stringify({ data, scope: { organizationId: 'org', userId } })) }
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', vi.fn(async () => response({ owners: [], ownersTruncated: false }))); vi.spyOn(crypto, 'randomUUID').mockReturnValue(id) })
async function prepare() { fireEvent.change(screen.getByLabelText('New lead status'), { target: { value: 'QUALIFIED' } }); fireEvent.click(screen.getByRole('button', { name: 'Preview changes' })); await screen.findByText('Practice Prospect') }
it('makes no request for an empty selection, previews exact changes, and requires confirmation before apply', async () => {
  const { rerender } = render(<BulkLeadControls {...props} selection={[]} />); expect(fetch).not.toHaveBeenCalled()
  rerender(<BulkLeadControls {...props} />); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  vi.mocked(fetch).mockResolvedValueOnce(response(preview)); await prepare()
  expect(screen.getByRole('button', { name: 'Confirm bulk update' })).toBeDisabled(); expect(fetch).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByLabelText('I reviewed these exact changes'))
  vi.mocked(fetch).mockResolvedValueOnce(response(receipt)); fireEvent.click(screen.getByRole('button', { name: 'Confirm bulk update' }))
  await screen.findByText('Updated 1 lead; 0 unchanged.'); expect(props.onApplied).toHaveBeenCalledOnce()
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body))).toEqual({ id, confirmed: true })
  expect(vi.mocked(fetch).mock.calls[2][1]?.headers).toMatchObject({ 'x-flowrish-workspace': 'org', 'x-flowrish-bulk-user': userId })
})
it('keeps the same confirmed receipt retry after a lost response, without automatic retries or a fresh preview', async () => {
  render(<BulkLeadControls {...props} />); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); vi.mocked(fetch).mockResolvedValueOnce(response(preview)); await prepare()
  fireEvent.click(screen.getByLabelText('I reviewed these exact changes')); vi.mocked(fetch).mockRejectedValueOnce(new TypeError('lost')); fireEvent.click(screen.getByRole('button', { name: 'Confirm bulk update' }))
  await screen.findByRole('button', { name: 'Retry confirmed request' }); expect(fetch).toHaveBeenCalledTimes(3); expect(screen.getByRole('button', { name: 'Preview changes' })).toBeDisabled()
  vi.mocked(fetch).mockResolvedValueOnce(response(receipt)); fireEvent.click(screen.getByRole('button', { name: 'Retry confirmed request' })); await screen.findByText('Updated 1 lead; 0 unchanged.')
  expect(vi.mocked(fetch).mock.calls[2][1]?.body).toBe(vi.mocked(fetch).mock.calls[3][1]?.body)
})
it('clears an unconfirmed preview when the page or selection changes and ignores an old preview response', async () => {
  const { rerender } = render(<BulkLeadControls {...props} />); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); vi.mocked(fetch).mockResolvedValueOnce(response(preview)); await prepare()
  rerender(<BulkLeadControls {...props} selection={[]} contextKey="page2" />); await waitFor(() => expect(screen.queryByText('Practice Prospect')).not.toBeInTheDocument()); expect(props.onApplied).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(2)
})
it('does not restore an old confirmation when the same filter is selected again', async () => {
  const { rerender } = render(<BulkLeadControls {...props} />); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); vi.mocked(fetch).mockResolvedValueOnce(response(preview)); await prepare(); fireEvent.click(screen.getByLabelText('I reviewed these exact changes'))
  rerender(<BulkLeadControls {...props} contextKey="page2" />); rerender(<BulkLeadControls {...props} />)
  expect(screen.queryByRole('button', { name: 'Confirm bulk update' })).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalledTimes(2)
})
