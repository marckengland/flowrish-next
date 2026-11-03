import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ReceptionistDemo } from './receptionist-demo'
const callbackHours = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z' }
const day = new Date(Date.now() + 7 * 86400000); while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1)
const date = day.toISOString().slice(0, 10)
it('rehearses requested, staff-confirmed and rescheduled callback times without API or storage writes', () => {
  const fetch = vi.spyOn(globalThis, 'fetch'), storage = vi.spyOn(Storage.prototype, 'setItem')
  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
  const check = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name }))
  try {
    render(<ReceptionistDemo business={{ name: 'Sample Business', hours: 'Weekdays 9 to 5', services: null, pricing: null, callbackHours }} />)
    click('Practice a callback')
    fireEvent.change(screen.getByLabelText('Sample preferred callback time'), { target: { value: `${date}T10:00` } })
    click('Review simulated callback'); expect(screen.getByRole('log')).toHaveTextContent(`${date} 10:00 (Asia/Manila)`)
    check('I confirm these fictional callback details.'); click('Confirm simulated callback')
    const time = screen.getByLabelText('Simulated confirmed callback time')
    expect(time).toHaveValue(`${date}T10:00`); fireEvent.change(time, { target: { value: `${date}T11:00` } })
    click('Preview simulated CRM handoff'); check('I approve this simulated lead and task.'); click('Create simulated CRM handoff')
    expect(screen.getByRole('region', { name: 'Simulated CRM receipt' })).toHaveTextContent(`${date} 11:00 (Asia/Manila)`)
    fireEvent.change(screen.getByRole('combobox', { name: 'Simulated callback outcome' }), { target: { value: 'retry' } })
    fireEvent.change(screen.getByLabelText('Simulated next callback time'), { target: { value: `${date}T12:00` } })
    click('Preview simulated outcome'); check('I confirm this simulated outcome.'); click('Record simulated outcome')
    expect(screen.getByRole('region', { name: 'Simulated CRM receipt' })).toHaveTextContent(`${date} 12:00 (Asia/Manila)`)
    expect(screen.getByText(`Requested callback time: ${date} 10:00 (Asia/Manila)`)).toBeVisible()
    expect(fetch).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled()
  } finally { vi.restoreAllMocks() }
})
