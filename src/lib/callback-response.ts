import { z } from 'zod'
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const businessHoursSchema = z.object({
  timeZone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }, 'Choose a valid time zone.'),
  opensAt: time, closesAt: time,
  businessDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length),
}).strict().refine(value => value.opensAt < value.closesAt, 'Use one opening interval within the same day.')
export type BusinessHours = z.infer<typeof businessHoursSchema>
const minute = 60000, day = 86400000
const clockMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3))
// Nominal capacity cap; DST can skip an opening, so the actual search allows
// up to 400 local dates rather than promising an exact 52-week wall deadline.
export function supportedTarget(hours: BusinessHours, minutes: number) { return minutes <= (clockMinutes(hours.closesAt) - clockMinutes(hours.opensAt)) * hours.businessDays.length * 52 }

/** Actual elapsed minutes whose local clock is inside the weekly schedule. */
export function businessCalendar(raw: BusinessHours): (start: Date, minutes: number) => Date {
  const hours = businessHoursSchema.parse(raw)
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: hours.timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const offsets = new Map<number, number>(), windows = new Map<number, Array<[number, number]>>()
  function civil(timestamp: number) {
    const parts = formatter.formatToParts(new Date(timestamp))
    const value = (key: string) => Number(parts.find(part => part.type === key)!.value)
    return { date: Date.UTC(value('year'), value('month') - 1, value('day')), clock: value('hour') * 60 + value('minute') }
  }
  function offset(timestamp: number) {
    const at = Math.floor(timestamp / minute) * minute
    if (!offsets.has(at)) { const local = civil(at); offsets.set(at, local.date + local.clock * minute - at) }
    return offsets.get(at)!
  }
  function openingWindows(date: number): Array<[number, number]> {
    if (windows.has(date)) return windows.get(date)!
    const result: Array<[number, number]> = []
    if (hours.businessDays.includes(new Date(date).getUTCDay())) {
      const possible = new Set<number>()
      for (let at = date - 18 * 3600000; at <= date + 42 * 3600000; at += 6 * 3600000) possible.add(offset(at))
      for (const shift of possible) {
        const start = date + clockMinutes(hours.opensAt) * minute - shift, end = date + clockMinutes(hours.closesAt) * minute - shift
        if (possible.size === 1) { result.push([start, end]); continue }
        // Only transition dates need subdivision. A local window may occur
        // twice during a fold, or lose some/all of its minutes during a gap.
        for (let at = start; at < end; at += 3600000) {
          const until = Math.min(end, at + 3600000), first = offset(at), last = offset(until - minute)
          if (first === shift && last === shift) result.push([at, until])
          else if (first !== last) for (let tick = at; tick < until; tick += minute) if (offset(tick) === shift) result.push([tick, Math.min(until, tick + minute)])
        }
      }
    }
    result.sort((left, right) => left[0] - right[0])
    const merged: Array<[number, number]> = []
    for (const interval of result) { const prior = merged[merged.length - 1]; if (prior && interval[0] <= prior[1]) prior[1] = Math.max(prior[1], interval[1]); else merged.push([...interval]) }
    windows.set(date, merged); return merged
  }
  return (start, minutes) => {
    if (!Number.isFinite(start.getTime()) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440 || !supportedTarget(hours, minutes)) throw new Error('Choose a target supported by the weekly business schedule.')
    let remaining = minutes * minute, date = civil(start.getTime()).date
    for (let searched = 0; searched < 400; searched++, date += day) for (const [opens, closes] of openingWindows(date)) {
      const cursor = Math.max(start.getTime(), opens)
      if (cursor >= closes) continue
      if (remaining <= closes - cursor) return new Date(cursor + remaining)
      remaining -= closes - cursor
    }
    throw new Error('The business deadline exceeds the supported calendar horizon.')
  }
}

const minutes = z.number().int().min(5).max(1440), stamp = z.string().datetime()
export const responsePolicyWriteSchema = z.object({ enabled: z.boolean(), handoffMinutes: minutes, attemptMinutes: minutes, backupUserId: z.string().uuid().nullable(), expectedUpdatedAt: stamp.nullable(), expectedBusinessUpdatedAt: stamp.nullable(), acknowledged: z.boolean() }).strict().superRefine((input, ctx) => { if (input.enabled && (!input.backupUserId || !input.acknowledged)) ctx.addIssue({ code: 'custom', message: 'Choose a manager and approve applying the policy before enabling.' }) })
export const responsePolicySchema = z.object({ enabled: z.boolean(), handoffMinutes: minutes, attemptMinutes: minutes, backupUserId: z.string().uuid().nullable(), hours: businessHoursSchema.nullable(), updatedAt: stamp.nullable(), businessUpdatedAt: stamp.nullable(), lastCheckedAt: stamp.nullable() }).strict()
export const responsePolicyMetadataSchema = z.object({ policy: responsePolicySchema, business: z.object({ businessName: z.string().max(120), hours: businessHoursSchema.nullable(), updatedAt: stamp.nullable() }).strict(), managers: z.array(z.object({ id: z.string().uuid(), name: z.string().max(100) }).strict()).max(201), managersTruncated: z.boolean(), managerAvailable: z.boolean(), hoursChanged: z.boolean() }).strict()
export const responseTargetQuerySchema = z.object({ filter: z.enum(['missed', 'all']).default('missed'), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict()
export const responseTargetRowSchema = z.object({ callbackId: z.string().uuid(), phase: z.enum(['handoff', 'attempt']), startedAt: stamp, dueAt: stamp, taskId: z.string().uuid().nullable(), assigneeName: z.string().max(100).nullable(), missed: z.boolean() }).strict().superRefine((row, ctx) => { if (row.phase === 'handoff' ? row.taskId !== null : row.taskId === null) ctx.addIssue({ code: 'custom', message: 'Unexpected response target.' }) })
export const responseTargetListSchema = z.object({ rows: z.array(responseTargetRowSchema).max(20), page: z.number().int().min(1).max(10000), hasMore: z.boolean(), policyEnabled: z.boolean() }).strict()
export type ResponsePolicyMetadata = z.infer<typeof responsePolicyMetadataSchema>
export type ResponseTargetList = z.infer<typeof responseTargetListSchema>
