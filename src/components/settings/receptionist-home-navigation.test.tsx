import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceptionistSetupWizard } from './receptionist-setup-wizard'
import { CallbackOutcomeQueue } from './callback-outcomes'
import { setupFixture } from './receptionist-setup-fixture.test-data'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/knowledge/knowledge-library', () => ({ KnowledgeLibrary: () => null }))
const fetch = vi.fn()
beforeEach(() => { fetch.mockReset(); vi.stubGlobal('fetch', fetch); window.history.replaceState(null, '', '/receptionist/setup?step=installation'); fetch.mockResolvedValue({ ok: true, json: async () => ({ data: setupFixture() }) }) })
afterEach(() => { window.history.replaceState(null, '', '/') })
describe('Receptionist home destinations', () => {
  it('opens the saved installation step without running checks, simulation, or enabling', async () => {
    render(<ReceptionistSetupWizard />)
    expect(await screen.findByRole('button', { name: '4. Simulation' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: 'Check website installation' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Receptionist home' })).toHaveAttribute('href', '/receptionist')
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toBe('/api/admin/receptionist/setup'); expect(fetch.mock.calls[0][1]).toEqual({ cache: 'no-store' })
    fireEvent.click(screen.getByRole('button', { name: '5. Review & enable' })); expect(screen.getByRole('button', { name: 'Enable website receptionist' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved setup' })); await screen.findByText(/Run and confirm a new local simulation/)
    expect(screen.getByRole('button', { name: '5. Review & enable' })).toHaveAttribute('aria-current', 'step')
    expect(fetch.mock.calls.every(call => !call[1]?.method)).toBe(true)
  })
  it('opens website configuration when the installation link has no saved websites', async () => {
    const fixture = setupFixture(); fixture.website.settings = null; fixture.readyToEnable = false; fetch.mockResolvedValue({ ok: true, json: async () => ({ data: fixture }) })
    render(<ReceptionistSetupWizard />)
    expect(await screen.findByRole('button', { name: '3. Website & budget' })).toHaveAttribute('aria-current', 'step')
    expect(screen.queryByRole('button', { name: 'Check website installation' })).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('provides a stable queue anchor without loading or changing callback work', () => {
    render(<CallbackOutcomeQueue />)
    expect(screen.getByRole('region', { name: 'Callback work queue' })).toHaveAttribute('id', 'callback-work')
    expect(screen.getByRole('button', { name: 'Load callback work queue' })).toBeEnabled(); expect(fetch).not.toHaveBeenCalled()
  })
})
