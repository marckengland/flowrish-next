import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceptionistDemo } from './receptionist-demo'
const business = { name: 'Flowrish', hours: 'Mon, Tue, Wed, Thu, Fri, 9:00 AM to 5:00 PM (Asia/Manila)', services: '<img src=x onerror=alert(1)> Approved sales CRM services.', pricing: 'Our team will confirm pricing.' }
function click(name: string) { fireEvent.click(screen.getByRole('button', { name })) }
function startCallback() { click('Practice a callback'); click('Review simulated callback'); fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm these fictional callback details.' })); click('Confirm simulated callback') }

describe('interactive receptionist demo screen', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  it('labels prewritten replies, renders approved text literally, and never calls the network or storage', () => {
    const fetch = vi.spyOn(globalThis, 'fetch'), storage = vi.spyOn(Storage.prototype, 'setItem')
    render(<ReceptionistDemo business={business} />)
    expect(screen.getByText('Prewritten replies. No live AI.', { exact: true })).toBeVisible()
    click('Ask about services'); expect(screen.getByRole('log')).toHaveTextContent(business.services)
    expect(screen.getByRole('log').querySelector('img')).toBe(null)
    click('Ask about pricing'); expect(screen.getByRole('log')).toHaveTextContent(business.pricing)
    click('Ask about hours'); expect(screen.getByRole('log')).toHaveTextContent(business.hours)
    fireEvent.change(screen.getByRole('textbox', { name: 'Sample visitor message' }), { target: { value: 'Guarantee tomorrow?' } }); click('Send demo message')
    expect(screen.getByRole('log')).toHaveTextContent('cannot answer that')
    expect(fetch).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled()
  })
  it('clears callback consent on correction and needs separate handoff and outcome approval', () => {
    const fetch = vi.spyOn(globalThis, 'fetch'), storage = vi.spyOn(Storage.prototype, 'setItem')
    render(<ReceptionistDemo business={business} />); click('Practice a callback'); click('Review simulated callback')
    expect(screen.getByRole('button', { name: 'Confirm simulated callback' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm these fictional callback details.' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Sample phone' }), { target: { value: '+12025550124' } })
    expect(screen.queryByRole('checkbox', { name: 'I confirm these fictional callback details.' })).toBe(null)
    click('Review simulated callback'); fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm these fictional callback details.' })); click('Confirm simulated callback')
    click('Preview simulated CRM handoff'); expect(screen.getByRole('button', { name: 'Create simulated CRM handoff' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I approve this simulated lead and task.' })); click('Create simulated CRM handoff')
    const receipt = screen.getByRole('region', { name: 'Simulated CRM receipt' })
    expect(receipt).toHaveTextContent('Jamie Example'); expect(receipt).toHaveTextContent('+12025550124'); expect(within(receipt).queryAllByRole('link')).toEqual([])
    click('Preview simulated outcome'); expect(screen.getByRole('button', { name: 'Record simulated outcome' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this simulated outcome.' })); click('Record simulated outcome')
    expect(receipt).toHaveTextContent('Closed'); expect(screen.getByRole('region', { name: 'Simulated outcome history' })).toHaveTextContent('Reached')
    expect(fetch).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled()
  })
  it('shows field errors and restart discards fictional data, receipts, consent and conversation', () => {
    render(<ReceptionistDemo business={business} />); click('Practice a callback')
    fireEvent.change(screen.getByRole('textbox', { name: 'Sample phone' }), { target: { value: 'bad' } }); click('Review simulated callback')
    expect(screen.getByRole('alert')).toHaveTextContent('international phone')
    click('Restart demo'); startCallback(); click('Preview simulated CRM handoff')
    click('Restart demo')
    expect(screen.queryByRole('region', { name: 'Simulated CRM receipt' })).toBe(null)
    expect(screen.queryByRole('textbox', { name: 'Sample phone' })).toBe(null)
    expect(screen.getByRole('log').children).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Sample visitor message' })).toHaveFocus()
  })
})
