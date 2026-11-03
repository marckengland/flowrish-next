import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Link from 'next/link'
import { ResponsePolicyEditor } from './response-policy-editor'
import { responseFixture, responseManager } from './response-fixture.test-data'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
const fetch = vi.fn(), ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) })
beforeEach(() => { fetch.mockReset(); fetch.mockResolvedValue(ok(responseFixture())); vi.stubGlobal('fetch', fetch) })
describe('explicit business-hours policy editing', () => {
  it('requires a selected manager and acknowledgement before enabling, with no write on load', async () => {
    render(<ResponsePolicyEditor />); const enable = await screen.findByRole('checkbox', { name: 'Enable callback response targets' }); expect(fetch).toHaveBeenCalledTimes(1); fireEvent.click(enable); fireEvent.change(screen.getByRole('combobox', { name: 'Escalation manager' }), { target: { value: responseManager } }); expect(screen.getByRole('button', { name: 'Save response targets' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve applying/ })); const next = responseFixture(); next.policy = { ...next.policy, enabled: true, backupUserId: responseManager, hours: next.business.hours, updatedAt: next.business.updatedAt, businessUpdatedAt: next.business.updatedAt }; next.managerAvailable = true; fetch.mockResolvedValueOnce(ok(next)); fireEvent.click(screen.getByRole('button', { name: 'Save response targets' })); await screen.findByText('Response targets saved. The next scheduled check will refresh waiting deadlines.'); expect(fetch.mock.calls[1][1].method).toBe('PUT'); const body = JSON.parse(fetch.mock.calls[1][1].body); expect(body).toEqual({ enabled: true, handoffMinutes: 60, attemptMinutes: 120, backupUserId: responseManager, expectedUpdatedAt: null, expectedBusinessUpdatedAt: next.business.updatedAt, acknowledged: true })
  })
  it('preserves conflicting edits and requires confirmation before reload or application navigation', async () => {
    render(<><Link href="/tasks">Open tasks</Link><ResponsePolicyEditor /></>); fireEvent.change(await screen.findByRole('spinbutton', { name: 'CRM handoff target (business minutes)' }), { target: { value: '90' } }); fetch.mockResolvedValueOnce({ ok: false, status: 409 }); fireEvent.click(screen.getByRole('button', { name: 'Save response targets' })); await screen.findByRole('alert'); expect(screen.getByRole('spinbutton', { name: 'CRM handoff target (business minutes)' })).toHaveValue(90)
    fireEvent.click(screen.getByRole('link', { name: 'Open tasks' })); expect(screen.getByRole('dialog')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Keep editing' })); fireEvent.click(screen.getByRole('button', { name: 'Reload target settings' })); expect(screen.getByRole('dialog')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved edits' })); await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'CRM handoff target (business minutes)' })).toHaveValue(60))
  })
  it('can pause an enabled policy without valid current hours, manager, or acknowledgement', async () => {
    const data = responseFixture(); data.policy = { ...data.policy, enabled: true, backupUserId: responseManager, updatedAt: data.business.updatedAt, hours: data.business.hours }; data.business.hours = null; data.managers = []; fetch.mockResolvedValueOnce(ok(data)); render(<ResponsePolicyEditor />); fireEvent.click(await screen.findByRole('checkbox', { name: 'Enable callback response targets' })); fetch.mockResolvedValueOnce(ok({ ...data, policy: { ...data.policy, enabled: false } })); fireEvent.click(screen.getByRole('button', { name: 'Save response targets' })); await screen.findByText('Response targets saved. The next scheduled check will refresh waiting deadlines.'); expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ enabled: false, acknowledged: false })
  })
})
