import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReceptionistSetupWizard } from './receptionist-setup-wizard'
import { ResponsePolicyEditor } from '@/components/callbacks/response-policy-editor'
import { CallbackHandoff } from './callback-handoff'
import { CallbackOutcomeTracker } from './callback-outcomes'
import { setupFixture } from './receptionist-setup-fixture.test-data'
import { responseFixture, responseManager } from '@/components/callbacks/response-fixture.test-data'
import { resolveCallbackTime } from '@/lib/callback-time'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/knowledge/knowledge-library', () => ({ KnowledgeLibrary: () => null }))
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) })
const closed = { date: '2026-11-09', closed: true as const }, id = responseManager
afterEach(() => { vi.unstubAllGlobals() })
describe('calendar exceptions across saved workflows', () => {
  it('saves a setup closure only after the business form is submitted and keeps the website off', async () => {
    const snapshot = setupFixture(); window.history.replaceState({}, '', '/receptionist/setup')
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.body) return ok(snapshot)
      const input = JSON.parse(String(init.body)); return ok({ ...snapshot, business: { ...snapshot.business, values: input.values }, version: 'b'.repeat(64) })
    }); vi.stubGlobal('fetch', fetch)
    render(<ReceptionistSetupWizard />)
    await screen.findByRole('button', { name: 'Previous step' }); fireEvent.click(screen.getByRole('button', { name: '1. Business' }))
    fireEvent.change(screen.getByLabelText('Exception date', { exact: true }), { target: { value: closed.date } }); fireEvent.click(screen.getByRole('button', { name: 'Add date override' }))
    expect(fetch).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Save business details' }))
    await screen.findByText('Business details saved.')
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).values.calendarExceptions).toEqual([closed]); expect(snapshot.website.settings?.enabled).toBe(false)
  })
  it('shows both calendar snapshots and requires approval before a response policy can adopt closures', async () => {
    const data = responseFixture(); data.policy = { ...data.policy, enabled: true, backupUserId: responseManager, hours: data.business.hours, updatedAt: data.business.updatedAt, businessUpdatedAt: data.business.updatedAt }; data.business.hours = { ...data.business.hours!, calendarExceptions: [closed] }; data.hoursChanged = true; data.managerAvailable = true
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => init?.body ? ok({ ...data, policy: { ...data.policy, hours: data.business.hours }, hoursChanged: false }) : ok(data)); vi.stubGlobal('fetch', fetch)
    render(<ResponsePolicyEditor />)
    await screen.findByText(/Business hours have changed/)
    expect(screen.getByText('2026-11-09: Closed')).toBeVisible(); expect(screen.getByRole('button', { name: 'Save response targets' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve applying these targets/ })); fireEvent.click(screen.getByRole('button', { name: 'Save response targets' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).acknowledged).toBe(true)
  })
  it('clears the pending-time warning after an approved handoff and notifies the inbox', async () => {
    const calendar = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z' }
    const day = new Date(Date.now() + 7 * 86400000); while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1)
    const date = day.toISOString().slice(0, 10), preferredTime = resolveCallbackTime({ localTime: date + 'T10:00', timeZone: calendar.timeZone, businessVersion: calendar.version }, calendar)
    const next = new Date(day.getTime() + 86400000).toISOString().slice(0, 10), chosen = resolveCallbackTime({ localTime: next + 'T11:00', timeZone: calendar.timeZone, businessVersion: calendar.version }, calendar)
    const onCalendarResolved = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.body) return ok({ callback: { id, fullName: 'Sample Visitor', phone: '+12025550123', reason: 'Services', siteOrigin: 'https://example.test', status: 'pending', consentedAt: calendar.version, createdAt: calendar.version, updatedAt: calendar.version, preferredTime, calendarReviewRequired: true }, receipt: null, leads: [{ id, label: 'Sample lead' }], contacts: [], members: [{ id, label: 'Sample staff' }], stages: [], matchesTruncated: false, choicesTruncated: false, callbackHours: { ...calendar, calendarExceptions: [{ date, closed: true }] } })
      const input = JSON.parse(String(init.body))
      return input.confirmed ? ok({ callbackId: id, leadId: id, taskId: id, createdAt: calendar.version, leadAvailable: true, taskAvailable: true, preferredTime }) : ok({ version: 'a'.repeat(64), draft: input, targetLabel: 'Sample lead', contactLabel: null, assigneeName: 'Sample staff', taskTitle: 'Callback', taskDescription: 'Approved callback', preferredTime, confirmedTime: chosen })
    }))
    render(<CallbackHandoff callbackId={id} onCalendarResolved={onCalendarResolved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare CRM handoff' })); await screen.findByRole('status', { name: 'Callback calendar review' })
    fireEvent.change(screen.getByRole('combobox', { name: 'CRM destination' }), { target: { value: id } }); fireEvent.change(screen.getByRole('combobox', { name: 'Callback owner' }), { target: { value: id } }); fireEvent.change(screen.getByLabelText('Confirmed callback time'), { target: { value: chosen.localTime } }); fireEvent.click(screen.getByRole('button', { name: 'Preview callback task' }))
    await screen.findByRole('button', { name: 'Confirm CRM handoff' }); fireEvent.click(screen.getByRole('checkbox', { name: /I approve creating this callback task/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm CRM handoff' }))
    await screen.findByText('This callback has already been handed to CRM.')
    expect(screen.queryByRole('status', { name: 'Callback calendar review' })).not.toBeInTheDocument(); expect(onCalendarResolved).toHaveBeenCalledTimes(1)
  })
  it.each(['handoff', 'outcome'] as const)('shows a calendar review warning in the %s panel without changing the saved callback', async kind => {
    const calendar = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z' }
    const day = new Date(Date.now() + 7 * 86400000); while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1)
    const date = day.toISOString().slice(0, 10), preferredTime = resolveCallbackTime({ localTime: `${date}T10:00`, timeZone: calendar.timeZone, businessVersion: calendar.version }, calendar)
    const hours = { ...calendar, calendarExceptions: [{ date, closed: true }] }, callback = { id, fullName: 'Sample Visitor', phone: '+12025550123', reason: 'Services', siteOrigin: 'https://example.test', status: 'pending', consentedAt: calendar.version, createdAt: calendar.version, updatedAt: calendar.version, preferredTime, calendarReviewRequired: true }
    const data = kind === 'handoff' ? { callback, receipt: null, leads: [], contacts: [], members: [], stages: [], matchesTruncated: false, choicesTruncated: false, callbackHours: hours } : { callbackId: id, taskId: id, version: 'c'.repeat(64), source: null, closed: false, canEdit: true, task: { id, title: 'Sample callback', dueDate: preferredTime.at, assigneeId: id, assigneeName: 'Sample staff', isComplete: false }, leadAvailable: true, members: [], membersTruncated: false, history: [], hasMore: false, beforeNext: null, preferredTime, callbackHours: hours, calendarReviewRequired: true }
    const fetch = vi.fn(async () => ok(data)); vi.stubGlobal('fetch', fetch)
    render(kind === 'handoff' ? <CallbackHandoff callbackId={id} /> : <CallbackOutcomeTracker callbackId={id} />)
    fireEvent.click(screen.getByRole('button', { name: kind === 'handoff' ? 'Prepare CRM handoff' : 'Track callback outcome' }))
    const warning = await screen.findByRole('status', { name: 'Callback calendar review' })
    expect(warning).toHaveTextContent(/Review.*current business calendar/); expect(fetch).toHaveBeenCalledTimes(1)
    expect(within(screen.getByRole('region', { name: kind === 'handoff' ? 'CRM callback handoff' : 'Callback outcome tracking' })).getByText(/Requested callback time:/)).toBeVisible()
  })
})
