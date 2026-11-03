import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReceptionistSetupSimulation } from './receptionist-setup-simulation'
import { setupFixture } from './receptionist-setup-fixture.test-data'
describe('local setup simulation', () => {
  it('requires a valid reviewed sample callback and consent without network or persistence', () => {
    const fetch = vi.fn(), complete = vi.fn(); vi.stubGlobal('fetch', fetch)
    render(<ReceptionistSetupSimulation snapshot={setupFixture()} completed={false} onComplete={complete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run local simulation' }))
    expect(screen.getByText('Repairs cost 500 pesos after inspection approval.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm simulated callback' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Sample phone' }), { target: { value: 'bad' } }); fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed these sample/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm simulated callback' })); expect(complete).not.toHaveBeenCalledWith(setupFixture().version); expect(screen.getByRole('alert')).toHaveTextContent('valid')
    fireEvent.change(screen.getByRole('textbox', { name: 'Sample phone' }), { target: { value: '+12025550123' } }); expect(screen.getByRole('button', { name: 'Confirm simulated callback' })).toBeDisabled(); fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed these sample/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm simulated callback' })); expect(complete).toHaveBeenLastCalledWith(setupFixture().version); expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps markup inert and disables a simulation without saved requirements', () => {
    const snapshot = setupFixture(); snapshot.business.values.businessName = '<script>alert(1)</script>'; snapshot.knowledge.sample!.text = '<img src=x onerror=alert(1)>'; const { container, rerender } = render(<ReceptionistSetupSimulation snapshot={snapshot} completed={false} onComplete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run local simulation' })); expect(container.querySelector('script,img')).toBeNull()
    rerender(<ReceptionistSetupSimulation key="new" snapshot={{ ...snapshot, readyToEnable: false }} completed={false} onComplete={vi.fn()} />); expect(screen.getByRole('button', { name: 'Run local simulation' })).toBeDisabled()
  })
})
