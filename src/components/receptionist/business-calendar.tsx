'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { calendarExceptionsSchema, calendarExceptionsText, type CalendarException } from '@/lib/business-calendar'

const field = 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
type SummaryProps = { value?: CalendarException[]; timeZone: string }
export function CalendarExceptionsSummary({ value, timeZone }: SummaryProps): React.JSX.Element {
  return <div className="min-w-0 space-y-1 text-sm"><p className="text-xs text-muted-foreground">Date-specific hours · {timeZone}</p>{value?.length ? <ul aria-label="Date-specific hours" className="max-h-60 space-y-1 overflow-y-auto break-words">{calendarExceptionsText({ calendarExceptions: value }).split('\n').map(line => <li key={line}>{line}</li>)}</ul> : <p className="text-xs text-muted-foreground">No date overrides. Weekly hours apply.</p>}</div>
}

export function CalendarExceptionsEditor({ value, onChange, timeZone, disabled = false }: SummaryProps & { onChange: (value: CalendarException[]) => void; disabled?: boolean }): React.JSX.Element {
  const [date, setDate] = useState(''), [availability, setAvailability] = useState('closed'), [opensAt, setOpensAt] = useState('09:00'), [closesAt, setClosesAt] = useState('17:00'), [error, setError] = useState('')
  const entries = value ?? []
  function add() {
    const parsed = calendarExceptionsSchema.safeParse([...entries, availability === 'closed' ? { date, closed: true } : { date, closed: false, opensAt, closesAt }])
    if (!parsed.success) { setError(parsed.error.issues.some(issue => issue.message.includes('each date')) ? 'Use each date once. Remove the existing override before replacing it.' : parsed.error.issues.some(issue => issue.message.includes('Closing time')) ? 'Closing time must follow opening time on the same day.' : 'Choose a valid date and hours. A calendar can have up to 100 date overrides.'); return }
    onChange(parsed.data); setDate(''); setError('')
  }
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-md border p-3"><legend className="px-1 text-sm font-medium">Holiday closures and special hours</legend>
    <p className="text-xs text-muted-foreground">Business time zone: {timeZone}. A date override replaces that date’s weekly hours, including weekends. Add each date before saving business settings.</p>
    <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium">Exception date<input className={field} type="date" value={date} onChange={event => { setDate(event.target.value); setError('') }} /></label><label className="block text-sm font-medium">Date availability<select className={field} value={availability} onChange={event => { setAvailability(event.target.value); setError('') }}><option value="closed">Closed all day</option><option value="hours">Different opening hours</option></select></label></div>
    {availability === 'hours' && <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium">Date opening time<input className={field} type="time" value={opensAt} onChange={event => setOpensAt(event.target.value)} /></label><label className="block text-sm font-medium">Date closing time<input className={field} type="time" value={closesAt} onChange={event => setClosesAt(event.target.value)} /></label></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="button" variant="outline" className="min-h-11" disabled={disabled || entries.length >= 100} onClick={add}>Add date override</Button>
    {entries.length ? <ul aria-label="Saved date overrides" className="max-h-80 space-y-2 overflow-y-auto">{entries.map(entry => <li key={entry.date} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 p-2 text-sm"><span>{entry.date}: {entry.closed ? 'Closed' : `${entry.opensAt}–${entry.closesAt}`}</span><Button type="button" variant="ghost" className="min-h-11" aria-label={`Remove exception for ${entry.date}`} onClick={() => { onChange(entries.filter(value => value.date !== entry.date)); setError('') }}>Remove</Button></li>)}</ul> : <p className="text-xs text-muted-foreground">No date overrides. Weekly hours apply.</p>}
    <p className="text-xs text-muted-foreground">Saving hours does not move existing callback tasks. Review affected callbacks and separately approve any response-policy calendar update. Update and approve Library hours separately for public answers.</p>
  </fieldset>
}
