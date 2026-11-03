import { z } from 'zod'

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  try { return Number(value.slice(0, 4)) >= 2000 && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value } catch { return false }
}, 'Choose a valid calendar date from 2000 onward.')
export const calendarExceptionsSchema = z.array(z.discriminatedUnion('closed', [
  z.object({ date, closed: z.literal(true) }).strict(),
  z.object({ date, closed: z.literal(false), opensAt: time, closesAt: time }).strict(),
])).max(100).superRefine((values, ctx) => {
  if (new Set(values.map(value => value.date)).size !== values.length) ctx.addIssue({ code: 'custom', message: 'Use each date once.' })
  if (values.some(value => !value.closed && value.opensAt >= value.closesAt)) ctx.addIssue({ code: 'custom', message: 'Closing time must follow opening time on the same day.' })
}).transform(values => [...values].sort((left, right) => left.date.localeCompare(right.date)))
export type CalendarException = z.infer<typeof calendarExceptionsSchema>[number]
type Schedule = { opensAt: string; closesAt: string; businessDays: number[]; calendarExceptions?: CalendarException[] }

export function openingHoursForDate(hours: Schedule, localDate: string): { opensAt: string; closesAt: string } | null {
  const override = hours.calendarExceptions?.find(value => value.date === localDate)
  if (override) return override.closed ? null : { opensAt: override.opensAt, closesAt: override.closesAt }
  return hours.businessDays.includes(new Date(`${localDate}T00:00:00Z`).getUTCDay()) ? { opensAt: hours.opensAt, closesAt: hours.closesAt } : null
}

export function isWithinBusinessHours(at: Date, hours: Schedule & { timeZone: string }): boolean {
  if (!Number.isFinite(at.getTime())) return false
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: hours.timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const value = (name: string) => parts.find(part => part.type === name)!.value
  const window = openingHoursForDate(hours, `${value('year')}-${value('month')}-${value('day')}`), clock = `${value('hour')}:${value('minute')}`
  return !!window && clock >= window.opensAt && clock < window.closesAt
}

export function calendarExceptionsText(hours: { calendarExceptions?: CalendarException[] }): string {
  return [...(hours.calendarExceptions ?? [])].sort((left, right) => left.date.localeCompare(right.date)).map(value => `${value.date}: ${value.closed ? 'Closed' : `${value.opensAt}–${value.closesAt}`}`).join('\n')
}
