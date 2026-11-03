import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CallbackHandoff } from './callback-handoff'
import { CallbackOutcomeTracker } from './callback-outcomes'
import { preferredTimeLabel, resolveCallbackTime } from '@/lib/callback-time'

const calendar = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z' }
const day = new Date(Date.now() + 7 * 86400000); while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1)
const date = day.toISOString().slice(0, 10), id = '11111111-1111-4111-8111-111111111111', owner = '22222222-2222-4222-8222-222222222222'
const preferredTime = resolveCallbackTime({ localTime: `${date}T10:00`, timeZone: calendar.timeZone, businessVersion: calendar.version }, calendar)
const chosen = resolveCallbackTime({ localTime: `${date}T11:00`, timeZone: calendar.timeZone, businessVersion: calendar.version }, calendar)
const callback = { id, fullName: 'Sample Visitor', phone: '+12025550123', reason: 'Services', siteOrigin: 'https://example.test', status: 'pending', consentedAt: calendar.version, createdAt: calendar.version, updatedAt: calendar.version, preferredTime }
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('staff confirmation in the saved business timezone', () => {
  it('labels retained outcome history with the business timezone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ callbackId: id, taskId: id, version: 'b'.repeat(64), source: null, closed: true, canEdit: false, task: null, leadAvailable: false, members: [], membersTruncated: false, history: [{ id, sequence: 1, outcome: 'retry', action: 'reschedule', notes: 'Sample reschedule', createdAt: calendar.version, createdByName: 'Sample staff', assigneeName: 'Sample staff', dueDate: chosen.at }], hasMore: false, beforeNext: null, preferredTime, callbackHours: calendar })))
    render(<CallbackOutcomeTracker callbackId={id} />)
    fireEvent.click(screen.getByRole('button', { name: 'Track callback outcome' }))
    expect(await screen.findByRole('region', { name: 'Callback outcome history' })).toHaveTextContent('Asia/Manila')
  })
  it('shows the request, converts the business-local staff choice, and invalidates handoff approval after edits', async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.body) return ok({ callback, receipt: null, leads: [{ id, label: 'Sample lead' }], contacts: [], members: [{ id: owner, label: 'Sample staff' }], stages: [], matchesTruncated: false, choicesTruncated: false, callbackHours: calendar })
      const draft = JSON.parse(String(init.body))
      return ok({ version: 'a'.repeat(64), draft, targetLabel: 'Sample lead', contactLabel: null, assigneeName: 'Sample staff', taskTitle: 'Callback', taskDescription: 'Staff-approved sample handoff', preferredTime, confirmedTime: chosen })
    })
    vi.stubGlobal('fetch', fetch); vi.stubEnv('TZ', 'UTC')
    render(<CallbackHandoff callbackId={id} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare CRM handoff' }))
    expect(await screen.findByText(`Requested callback time: ${preferredTimeLabel(preferredTime)}`)).toBeVisible()
    const time = screen.getByLabelText('Confirmed callback time')
    expect(time).toHaveValue(preferredTime.localTime)
    fireEvent.change(screen.getByRole('combobox', { name: 'CRM destination' }), { target: { value: id } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Callback owner' }), { target: { value: owner } })
    fireEvent.change(time, { target: { value: chosen.localTime } }); fireEvent.click(screen.getByRole('button', { name: 'Preview callback task' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).dueDate).toBe(chosen.at)
    expect(await screen.findByText(`Staff-confirmed callback time: ${preferredTimeLabel(chosen)}`)).toBeVisible()
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve creating this callback task/ }))
    fireEvent.change(time, { target: { value: `${date}T12:00` } })
    expect(screen.queryByRole('button', { name: 'Confirm CRM handoff' })).toBe(null)
  })
  it('shows a retained request after source deletion and previews rescheduling in the business timezone', async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.body) return ok({ callbackId: id, taskId: id, version: 'b'.repeat(64), source: null, closed: false, canEdit: true, task: { id, title: 'Sample callback', dueDate: preferredTime.at, assigneeId: owner, assigneeName: 'Sample staff', isComplete: false }, leadAvailable: true, members: [{ id: owner, label: 'Sample staff' }], membersTruncated: false, history: [], hasMore: false, beforeNext: null, preferredTime, callbackHours: calendar })
      const input = JSON.parse(String(init.body))
      return ok({ ...input, callbackId: id, version: 'c'.repeat(64), taskTitle: 'Sample callback', taskChange: 'Update existing task', sourceChange: 'Source removed', nextOwner: 'Sample staff', nextDueDate: chosen.at, reopensTask: false, confirmedTime: chosen })
    })
    vi.stubGlobal('fetch', fetch); vi.stubEnv('TZ', 'UTC')
    render(<CallbackOutcomeTracker callbackId={id} />)
    fireEvent.click(screen.getByRole('button', { name: 'Track callback outcome' }))
    expect(await screen.findByText(`Requested callback time: ${preferredTimeLabel(preferredTime)}`)).toBeVisible()
    fireEvent.change(screen.getByRole('combobox', { name: 'Callback result' }), { target: { value: 'retry' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Next action' }), { target: { value: 'reschedule' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Next callback owner' }), { target: { value: owner } })
    const time = screen.getByLabelText('Next callback time')
    fireEvent.change(time, { target: { value: chosen.localTime } }); fireEvent.click(screen.getByRole('button', { name: 'Preview outcome' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).draft.dueDate).toBe(chosen.at)
    expect(await screen.findByText(`Staff-confirmed callback time: ${preferredTimeLabel(chosen)}`)).toBeVisible()
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve recording this result/ })); fireEvent.change(time, { target: { value: `${date}T12:00` } })
    expect(screen.queryByRole('button', { name: 'Confirm callback outcome' })).toBe(null)
  })
})
