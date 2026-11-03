import { z } from 'zod'
import { businessHoursSchema, type BusinessHours } from './callback-response'

export const callbackCalendarSchema = z.object({ timeZone: z.string().min(1).max(100), opensAt: z.string().max(5), closesAt: z.string().max(5), businessDays: z.array(z.number().int()).max(7), version: z.string().datetime() }).strict().superRefine(({ version: _version, ...hours }, ctx) => {
  if (!businessHoursSchema.safeParse(hours).success) ctx.addIssue({ code: 'custom', message: 'Saved callback hours are unavailable.' })
})
export const preferredTimeInputSchema = z.object({ localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), timeZone: z.string().min(1).max(100), businessVersion: z.string().datetime() }).strict()
export const preferredTimeSchema = preferredTimeInputSchema.extend({ at: z.string().datetime() }).strict()
export type CallbackCalendar = BusinessHours & { version: string }
export type PreferredTime = z.infer<typeof preferredTimeSchema>
export class CallbackTimeError extends Error { constructor(message: string, public readonly status = 400) { super(message); this.name = 'CallbackTimeError' } }

export function callbackCalendarFromSettings(stored: { settings: unknown; updatedAt: Date } | null): CallbackCalendar | null {
  if (!stored || !stored.settings || typeof stored.settings !== 'object' || Array.isArray(stored.settings) || !Number.isFinite(stored.updatedAt.getTime())) return null
  const value = stored.settings as Record<string, unknown>
  const parsed = callbackCalendarSchema.safeParse({ timeZone: value.timeZone, opensAt: value.opensAt, closesAt: value.closesAt, businessDays: value.businessDays, version: stored.updatedAt.toISOString() })
  return parsed.success ? parsed.data : null
}
function localClock(timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return (at: number) => {
    const parts = formatter.formatToParts(new Date(at)), part = (name: string) => parts.find(value => value.type === name)!.value
    const localTime = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
    const nominal = Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')), Number(part('hour')), Number(part('minute')))
    return { localTime, nominal }
  }
}
export function resolveCallbackTime(raw: z.input<typeof preferredTimeInputSchema>, rawCalendar: CallbackCalendar, now = new Date()): PreferredTime {
  const input = preferredTimeInputSchema.parse(raw), calendar = callbackCalendarSchema.parse(rawCalendar)
  if (input.timeZone !== calendar.timeZone || input.businessVersion !== calendar.version) throw new CallbackTimeError('Saved callback hours changed. Reload and review the requested time again.', 409)
  const [year, month, day, hour, minute] = input.localTime.split(/[-T:]/).map(Number)
  const nominal = Date.UTC(year, month - 1, day, hour, minute)
  if (year < 2000 || new Date(nominal).toISOString().slice(0, 16) !== input.localTime) throw new CallbackTimeError('Choose a valid calendar date and time.')
  const clock = localClock(calendar.timeZone), offsets = new Set<number>()
  for (let at = nominal - 36 * 3600000; at <= nominal + 36 * 3600000; at += 6 * 3600000) offsets.add(clock(at).nominal - at)
  const candidates = [...offsets].map(offset => nominal - offset).filter(at => clock(at).localTime === input.localTime)
  if (candidates.length !== 1) throw new CallbackTimeError('That time is unavailable or ambiguous during a clock change. Choose another time.')
  const at = candidates[0], current = now.getTime()
  if (!Number.isFinite(current) || at <= current || at > current + 90 * 86400000) throw new CallbackTimeError('Choose a future callback time within the next 90 days.')
  const minutes = hour * 60 + minute, opening = calendar.opensAt.split(':').map(Number), closing = calendar.closesAt.split(':').map(Number)
  if (!calendar.businessDays.includes(new Date(nominal).getUTCDay()) || minutes < opening[0] * 60 + opening[1] || minutes >= closing[0] * 60 + closing[1]) throw new CallbackTimeError('Choose a time within the saved business hours.')
  return { ...input, at: new Date(at).toISOString() }
}
export function validateCallbackInstant(at: string, calendar: CallbackCalendar, now = new Date()): PreferredTime {
  const timestamp = new Date(at).getTime()
  if (!Number.isFinite(timestamp) || timestamp % 60000 !== 0) throw new CallbackTimeError('Choose a valid callback time with minute precision.')
  const localTime = localClock(calendar.timeZone)(timestamp).localTime
  return resolveCallbackTime({ localTime, timeZone: calendar.timeZone, businessVersion: calendar.version }, calendar, now)
}
export function preferredTimeLabel(value: PreferredTime): string { return `${value.localTime.replace('T', ' ')} (${value.timeZone})` }
