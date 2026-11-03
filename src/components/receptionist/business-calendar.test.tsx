import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { CalendarExceptionsEditor, CalendarExceptionsSummary } from './business-calendar'
import type { CalendarException } from '@/lib/business-calendar'

function Editor() {
  const [value, setValue] = useState<CalendarException[]>([])
  return <><CalendarExceptionsEditor timeZone="Asia/Manila" value={value} onChange={setValue} /><output aria-label="Saved draft">{JSON.stringify(value)}</output></>
}
describe('date-specific hours editor', () => {
  it('adds a closure and custom hours, retains ISO business dates and removes only the chosen date', () => {
    render(<Editor />)
    expect(screen.getByText(/Business time zone: Asia\/Manila/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('Exception date', { exact: true }), { target: { value: '2026-11-09' } }); fireEvent.click(screen.getByRole('button', { name: 'Add date override' }))
    expect(screen.getByLabelText('Saved draft')).toHaveTextContent('"date":"2026-11-09","closed":true')
    fireEvent.change(screen.getByLabelText('Exception date', { exact: true }), { target: { value: '2026-11-10' } }); fireEvent.change(screen.getByLabelText('Date availability', { exact: true }), { target: { value: 'hours' } })
    fireEvent.change(screen.getByLabelText('Date opening time', { exact: true }), { target: { value: '11:00' } }); fireEvent.change(screen.getByLabelText('Date closing time', { exact: true }), { target: { value: '14:00' } }); fireEvent.click(screen.getByRole('button', { name: 'Add date override' }))
    expect(screen.getByLabelText('Saved draft')).toHaveTextContent('"opensAt":"11:00","closesAt":"14:00"')
    fireEvent.click(screen.getByRole('button', { name: 'Remove exception for 2026-11-09' }))
    expect(screen.getByLabelText('Saved draft')).not.toHaveTextContent('2026-11-09'); expect(screen.getByLabelText('Saved draft')).toHaveTextContent('2026-11-10')
  })
  it('rejects duplicate dates and invalid time intervals without replacing an existing row', () => {
    render(<Editor />)
    const date = screen.getByLabelText('Exception date', { exact: true }), add = screen.getByRole('button', { name: 'Add date override' })
    fireEvent.change(date, { target: { value: '2026-11-09' } }); fireEvent.click(add); fireEvent.change(date, { target: { value: '2026-11-09' } }); fireEvent.click(add)
    expect(screen.getByRole('alert')).toHaveTextContent(/each date once/)
    fireEvent.change(date, { target: { value: '2026-11-10' } }); fireEvent.change(screen.getByLabelText('Date availability', { exact: true }), { target: { value: 'hours' } }); fireEvent.change(screen.getByLabelText('Date closing time', { exact: true }), { target: { value: '08:00' } }); fireEvent.click(add)
    expect(screen.getByRole('alert')).toHaveTextContent(/closing time/i)
    expect(JSON.parse(screen.getByLabelText('Saved draft').textContent!)).toEqual([{ date: '2026-11-09', closed: true }])
  })
  it('shows a read-only calendar summary and no editing controls', () => {
    render(<CalendarExceptionsSummary timeZone="Asia/Manila" value={[{ date: '2026-11-09', closed: true }, { date: '2026-11-10', closed: false, opensAt: '11:00', closesAt: '14:00' }]} />)
    const list = screen.getByRole('list', { name: 'Date-specific hours' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2); expect(list).toHaveTextContent('2026-11-09: Closed'); expect(list).toHaveTextContent('2026-11-10: 11:00–14:00')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
