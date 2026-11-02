import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CallbackHandoff } from './callback-handoff'
const callbackId = '11111111-1111-4111-8111-111111111111', leadId = '22222222-2222-4222-8222-222222222222', memberId = '33333333-3333-4333-8333-333333333333'
const time = '2026-11-03T00:00:00.000Z'
const options = { callback: { id: callbackId, fullName: 'Jamie Example', phone: '+639171234567', reason: '<img src=x onerror=alert(1)>', status: 'pending', siteOrigin: 'https://shop.example', consentedAt: time, createdAt: time, updatedAt: time }, receipt: null, leads: [{ id: leadId, label: 'Jamie Existing' }], contacts: [], members: [{ id: memberId, label: 'Owner' }], stages: [], matchesTruncated: false, choicesTruncated: false }
const mockFetch = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset() })
function respond(data: unknown, status = 200) { return { ok: status === 200, status, json: async () => ({ data }) } }
async function loaded() { render(<CallbackHandoff callbackId={callbackId} />); expect(mockFetch).not.toHaveBeenCalled(); mockFetch.mockResolvedValueOnce(respond(options)); fireEvent.click(screen.getByRole('button', { name: 'Prepare CRM handoff' })); await screen.findByLabelText('CRM destination'); fireEvent.change(screen.getByLabelText('CRM destination'), { target: { value: leadId } }); fireEvent.change(screen.getByLabelText('Callback owner'), { target: { value: memberId } }); fireEvent.change(screen.getByLabelText('Callback deadline'), { target: { value: '2030-01-01T10:00' } }) }
describe('explicit callback CRM handoff', () => {
  it('does not fetch on mount, renders untrusted details as text, and requires preview and approval', async () => {
    await loaded(); expect(document.querySelector('img')).toBeNull(); expect(screen.getByText(options.callback.reason)).toBeVisible()
    const draft = { expectedUpdatedAt: time, target: { mode: 'lead', leadId }, assigneeId: memberId, dueDate: new Date('2030-01-01T10:00').toISOString(), acknowledgeDuplicate: false }
    const preview = { version: 'a'.repeat(64), draft, targetLabel: 'Jamie Existing', contactLabel: null, assigneeName: 'Owner', taskTitle: 'Callback: Jamie Example', taskDescription: options.callback.reason }
    mockFetch.mockResolvedValueOnce(respond(preview)); fireEvent.click(screen.getByRole('button', { name: 'Preview callback task' })); await screen.findByRole('checkbox', { name: /I approve creating/ })
    expect(screen.getByRole('button', { name: 'Confirm CRM handoff' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve creating/ })); expect(screen.getByRole('button', { name: 'Confirm CRM handoff' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Callback deadline'), { target: { value: '2030-01-02T10:00' } }); expect(screen.queryByRole('button', { name: 'Confirm CRM handoff' })).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
  it('uses exactly the reviewed body and displays CRM links after confirmation', async () => {
    await loaded(); mockFetch.mockImplementationOnce(async (_url, init) => respond({ version: 'b'.repeat(64), draft: JSON.parse(init.body), targetLabel: 'Jamie Existing', contactLabel: null, assigneeName: 'Owner', taskTitle: 'Callback: Jamie', taskDescription: 'Approved callback details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview callback task' })); fireEvent.click(await screen.findByRole('checkbox', { name: /I approve creating/ }))
    mockFetch.mockResolvedValueOnce(respond({ callbackId, leadId, taskId: memberId, createdAt: time, leadAvailable: true, taskAvailable: true })); fireEvent.click(screen.getByRole('button', { name: 'Confirm CRM handoff' }))
    await screen.findByRole('link', { name: 'Open callback task' }); expect(screen.getByRole('link', { name: 'Open lead' })).toHaveAttribute('href', `/leads/${leadId}`)
    const body = JSON.parse(mockFetch.mock.calls[2][1].body); expect(body.confirmed).toBe(true); expect(body.previewVersion).toBe('b'.repeat(64)); expect(body.draft.target).toEqual({ mode: 'lead', leadId }); expect(mockFetch.mock.calls[2][0]).toBe(`/api/admin/website-receptionist/callbacks/${callbackId}/handoff`)
  })
  it('preserves choices on stale errors and hides unsafe server errors', async () => {
    await loaded(); mockFetch.mockResolvedValueOnce(respond({ error: 'secret SQL diagnostic' }, 409)); fireEvent.click(screen.getByRole('button', { name: 'Preview callback task' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Reload handoff choices'))
    expect(screen.getByLabelText('CRM destination')).toHaveValue(leadId); expect(screen.queryByText('secret SQL diagnostic')).toBeNull()
  })
  it('rejects response identity mismatch and unexpected changes to a reviewed draft', async () => {
    await loaded()
    mockFetch.mockImplementationOnce(async (_url, init) => respond({ version: 'c'.repeat(64), draft: { ...JSON.parse(init.body), assigneeId: leadId }, targetLabel: 'Different destination', contactLabel: null, assigneeName: 'Wrong owner', taskTitle: 'Changed task', taskDescription: 'Details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview callback task' })); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Confirm CRM handoff' })).toBeNull()
    mockFetch.mockResolvedValueOnce(respond({ ...options, callback: { ...options.callback, id: memberId } })); fireEvent.click(screen.getByRole('button', { name: 'Reload handoff choices' })); await screen.findByRole('alert'); expect(screen.queryByText('Different destination')).toBeNull()
  })
  it('reloads a receipt after an ambiguous confirmation without resubmitting work', async () => {
    await loaded()
    mockFetch.mockImplementationOnce(async (_url, init) => respond({ version: 'd'.repeat(64), draft: JSON.parse(init.body), targetLabel: 'Jamie Existing', contactLabel: null, assigneeName: 'Owner', taskTitle: 'Callback', taskDescription: 'Details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview callback task' })); fireEvent.click(await screen.findByRole('checkbox', { name: /I approve creating/ }))
    mockFetch.mockRejectedValueOnce(new Error('Lost response')); fireEvent.click(screen.getByRole('button', { name: 'Confirm CRM handoff' })); await screen.findByRole('alert')
    mockFetch.mockResolvedValueOnce(respond({ ...options, receipt: { callbackId, leadId, taskId: memberId, createdAt: time, leadAvailable: true, taskAvailable: true } })); fireEvent.click(screen.getByRole('button', { name: 'Reload handoff choices' })); await screen.findByRole('link', { name: 'Open callback task' }); expect(mockFetch.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(2)
  })
  it('shows a durable receipt without offering another conversion when targets were deleted', async () => {
    mockFetch.mockResolvedValueOnce(respond({ ...options, receipt: { callbackId, leadId, taskId: memberId, createdAt: time, leadAvailable: false, taskAvailable: false } })); render(<CallbackHandoff callbackId={callbackId} />); fireEvent.click(screen.getByRole('button', { name: 'Prepare CRM handoff' })); await screen.findByText('This callback has already been handed to CRM.')
    expect(screen.queryByRole('button', { name: 'Preview callback task' })).toBeNull(); expect(screen.queryByRole('link', { name: 'Open callback task' })).toBeNull()
  })
})
