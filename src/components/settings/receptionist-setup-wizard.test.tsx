import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import Link from 'next/link'
import { SETUP_HISTORY_SCRIPT } from '@/lib/receptionist-setup-history'
beforeAll(() => { window.eval(SETUP_HISTORY_SCRIPT) })
import { ReceptionistSetupWizard } from './receptionist-setup-wizard'
import { setupFixture } from './receptionist-setup-fixture.test-data'
vi.mock('@/components/knowledge/knowledge-library', () => ({ KnowledgeLibrary: function Library({ onDirtyChange }: { onDirtyChange: (value: boolean) => void }) { const [text, setText] = useState(''); return <><button onClick={() => onDirtyChange(true)}>Edit sample Library draft</button><input aria-label="Mock Library text" value={text} onChange={event => { setText(event.target.value); onDirtyChange(true) }} /></> } }))
vi.mock('./website-receptionist-settings', () => ({ WebsiteReceptionistSettings: ({ onSaved }: { onSaved: () => void }) => <button onClick={onSaved}>Refresh saved website</button> }))
const fetch = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
beforeEach(() => { fetch.mockReset(); vi.stubGlobal('fetch', fetch); fetch.mockResolvedValue({ ok: true, json: async () => ({ data: setupFixture() }) }) })
async function simulate() {
  fireEvent.click(await screen.findByRole('button', { name: 'Run local simulation' })); fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed these sample/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm simulated callback' })); fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
}
describe('guided website setup', () => {
  it('requires confirmation before browser history can discard drafts', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false), push = vi.spyOn(window.history, 'pushState')
    render(<ReceptionistSetupWizard />); fireEvent.click(await screen.findByRole('button', { name: '1. Business' })); fireEvent.change(screen.getByRole('textbox', { name: 'Business name' }), { target: { value: 'History draft' } })
    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })) }); expect(confirm).toHaveBeenCalledTimes(1); expect(push).toHaveBeenCalledTimes(1); expect(screen.getByRole('textbox', { name: 'Business name' })).toHaveValue('History draft')
    confirm.mockReturnValue(true); act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })) }); expect(confirm).toHaveBeenCalledTimes(2); expect(push).toHaveBeenCalledTimes(1); confirm.mockRestore(); push.mockRestore()
  })
  it('resets embedded edits only after a confirmed successful reload, preserving them on failure', async () => {
    render(<ReceptionistSetupWizard />); fireEvent.click(await screen.findByRole('button', { name: '2. Library' })); fireEvent.change(screen.getByRole('textbox', { name: 'Mock Library text' }), { target: { value: 'Unsaved Library draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Reload saved setup' })); fetch.mockResolvedValueOnce({ ok: false, status: 503 }); fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved edits' })); await screen.findByRole('alert'); expect(screen.getByRole('textbox', { name: 'Mock Library text' })).toHaveValue('Unsaved Library draft')
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved setup' })); expect(screen.getByRole('alertdialog')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved edits' })); await waitFor(() => expect(screen.getByRole('textbox', { name: 'Mock Library text' })).toHaveValue('')); fireEvent.click(screen.getByRole('button', { name: '1. Business' })); expect(screen.queryByRole('alertdialog')).toBeNull()
  })
  it('guards application links and blocks leaving while a write is pending', async () => {
    render(<><Link href="/leads">Open leads</Link><ReceptionistSetupWizard /></>); fireEvent.click(await screen.findByRole('button', { name: '1. Business' })); fireEvent.change(screen.getByRole('textbox', { name: 'Business name' }), { target: { value: 'Unsaved edit' } }); fireEvent.click(screen.getByRole('link', { name: 'Open leads' })); expect(screen.getByRole('alertdialog')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Keep editing' })); expect(screen.getByRole('textbox', { name: 'Business name' })).toHaveValue('Unsaved edit')
    fetch.mockImplementationOnce(() => new Promise(() => {})); fireEvent.click(screen.getByRole('button', { name: 'Save business details' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled()); const event = new MouseEvent('click', { bubbles: true, cancelable: true }); act(() => { screen.getByRole('link', { name: 'Open leads' }).dispatchEvent(event) }); expect(event.defaultPrevented).toBe(true)
  })
  it('never launches automatically and requires a local simulation plus two separate acknowledgements', async () => {
    render(<ReceptionistSetupWizard />); await simulate()
    const launch = screen.getByRole('button', { name: 'Enable website receptionist' }); expect(launch).toBeDisabled(); expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand this simulation/ })); fireEvent.click(screen.getByRole('checkbox', { name: /I approve the saved websites/ })); expect(launch).toBeEnabled()
    fetch.mockResolvedValueOnce({ ok: true, json: async () => { const next = setupFixture(); next.website.settings!.enabled = true; return { data: next } } }); fireEvent.click(launch)
    await screen.findByText('Your website receptionist is enabled.'); expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ expectedVersion: 'a'.repeat(64), acknowledged: true, simulationReviewed: true })
  })
  it('guards Library drafts when changing steps and preserves them when staying', async () => {
    render(<ReceptionistSetupWizard />); fireEvent.click(await screen.findByRole('button', { name: '2. Library' })); fireEvent.click(screen.getByRole('button', { name: 'Edit sample Library draft' })); fireEvent.click(screen.getByRole('button', { name: '1. Business' })); expect(screen.getByRole('alertdialog')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Keep editing' })); expect(screen.getByRole('button', { name: 'Edit sample Library draft' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1. Business' })); fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved edits' })); expect(screen.getByRole('textbox', { name: 'Business name' })).toHaveValue('Sample Repairs'); expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('invalidates rehearsal after a changed saved snapshot and keeps failed launch retryable', async () => {
    render(<ReceptionistSetupWizard />); await simulate(); fireEvent.click(screen.getByRole('checkbox', { name: /I understand this simulation/ })); fireEvent.click(screen.getByRole('checkbox', { name: /I approve the saved websites/ }))
    fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: { message: 'private diagnostic' } }) }); fireEvent.click(screen.getByRole('button', { name: 'Enable website receptionist' })); await screen.findByRole('alert'); expect(screen.queryByText('private diagnostic')).toBeNull()
    const next = setupFixture(); next.version = 'b'.repeat(64); fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: next }) }); fireEvent.click(screen.getByRole('button', { name: 'Reload saved setup' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Enable website receptionist' })).toBeDisabled()); expect(screen.getByText(/Run and confirm a new local simulation/)).toBeInTheDocument()
  })
  it('handles permission failure and already-enabled state without writes', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 403 }); const { unmount } = render(<ReceptionistSetupWizard />); expect(await screen.findByRole('alert')).toHaveTextContent('administrator'); unmount()
    const next = setupFixture(); next.website.settings!.enabled = true; fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: next }) }); render(<ReceptionistSetupWizard />); await screen.findByText('Your website receptionist is enabled.'); expect(screen.queryByRole('button', { name: 'Enable website receptionist' })).toBeNull(); expect(fetch.mock.calls.every(call => !call[1]?.method)).toBe(true)
  })
})
