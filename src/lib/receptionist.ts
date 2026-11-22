import { z } from 'zod'
import { calendarExceptionsSchema, isWithinBusinessHours, openingHoursForDate } from './business-calendar'

export const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use an international number, such as +639171234567.')
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export const receptionistConfigSchema = z.object({
  enabled: z.boolean(),
  businessName: z.string().trim().min(1).max(120),
  knowledge: z.string().trim().max(8000),
  mode: z.enum(['after_hours', 'always']),
  timeZone: z.string().max(100).refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
  }, 'Choose a valid time zone.'),
  calendarExceptions: calendarExceptionsSchema.optional(),
  opensAt: timeSchema,
  closesAt: timeSchema,
  businessDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  forwardTo: z.union([z.literal(''), phoneSchema]),
  assigneeId: z.union([z.string().uuid(), z.literal('')]),
  stageId: z.union([z.string().uuid(), z.literal('')]),
}).superRefine((value, ctx) => {
  if (value.enabled && !value.assigneeId) ctx.addIssue({ code: 'custom', path: ['assigneeId'], message: 'Choose a callback owner.' })
  if (value.enabled && !value.stageId) ctx.addIssue({ code: 'custom', path: ['stageId'], message: 'Choose an open pipeline stage.' })
  if (value.opensAt >= value.closesAt) ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'Closing time must be after opening time on the same day.' })
  if (value.enabled && value.mode === 'after_hours' && !value.forwardTo) ctx.addIssue({ code: 'custom', path: ['forwardTo'], message: 'Add a daytime forwarding number before enabling after-hours mode.' })
})

export type ReceptionistConfig = z.infer<typeof receptionistConfigSchema>

export const receptionistExtractionSchema = z.object({
  fullName: z.string().trim().max(120).nullable(),
  phone: z.union([phoneSchema, z.literal('')]).nullable(),
  reason: z.string().trim().max(2000).nullable(),
  reply: z.string().trim().min(1).max(600),
})
export type ReceptionistExtraction = z.infer<typeof receptionistExtractionSchema>

export const callStateSchema = z.object({
  fullName: z.string().max(120), phone: z.string().max(16), reason: z.string().max(2000),
  awaitingConfirmation: z.boolean(), turns: z.number().int().min(0).max(14), silence: z.number().int().min(0),
  fallbackField: z.enum(['fullName', 'phone', 'reason']).nullable(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4096) })).max(28),
})
export type CallState = z.infer<typeof callStateSchema>

export function initialCallState(from: string): CallState {
  return { fullName: '', phone: phoneSchema.safeParse(from).success ? from : '', reason: '', awaitingConfirmation: false, turns: 0, silence: 0, fallbackField: null, messages: [] }
}

export function receptionistGreeting(businessName: string): string {
  return `Thank you for calling ${businessName}. I am an AI receptionist. I can answer basic questions and take a callback message. What is your name, and how can we help?`
}

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const read = (name: string) => Number(parts.find((p) => p.type === name)?.value)
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute') }
}

export function isBusinessOpen(config: ReceptionistConfig, now: Date): boolean {
  return isWithinBusinessHours(now, config)
}

export function nextBusinessOpening(config: ReceptionistConfig, now: Date): Date {
  const p = localParts(now, config.timeZone)
  for (let offset = 0; offset <= 14 + (config.calendarExceptions?.length ?? 0) * 7; offset++) {
    const localDate = new Date(Date.UTC(p.year, p.month - 1, p.day + offset)).toISOString().slice(0, 10)
    const opening = openingHoursForDate(config, localDate)
    if (!opening) continue
    const [hour, minute] = opening.opensAt.split(':').map(Number)
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day + offset, hour, minute))
    const target = day.getTime()
    let candidate = target
    let converged = false
    for (let adjustment = 0; adjustment < 4; adjustment++) {
      const actual = localParts(new Date(candidate), config.timeZone)
      const difference = target - Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)
      if (!difference) { converged = true; break }
      candidate += difference
    }
    if (!converged) {
      // A spring-forward gap has no exact UTC equivalent. Use the first
      // valid business minute on that local date, or skip a closed date.
      const near = candidate
      candidate = Number.NaN
      for (let shift = -180; shift <= 180; shift++) {
        const probe = new Date(near + shift * 60_000)
        const actual = localParts(probe, config.timeZone)
        if (actual.year === day.getUTCFullYear() && actual.month === day.getUTCMonth() + 1 && actual.day === day.getUTCDate() && isBusinessOpen(config, probe)) { candidate = probe.getTime(); break }
      }
    }
    if (candidate > now.getTime()) return new Date(candidate)
  }
  throw new Error('No next business opening found')
}

export function escapeVoiceXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export function gatherTwiml(reply: string, action: string, finish: boolean): string {
  const say = `<Say language="en-US">${escapeVoiceXml(reply)}</Say>`
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${finish ? `${say}<Hangup/>` : `<Gather input="speech dtmf" finishOnKey="#" timeout="7" speechTimeout="auto" actionOnEmptyResult="true" method="POST" action="${escapeVoiceXml(action)}">${say}</Gather>`}</Response>`
}

type CallInput = { speech?: string; digits?: string }
type Generate = (state: CallState, config: ReceptionistConfig) => Promise<ReceptionistExtraction>

export async function advanceCall(previous: CallState, input: CallInput, config: ReceptionistConfig, generate: Generate) {
  const state: CallState = { ...previous, messages: [...previous.messages], turns: previous.turns + 1 }
  const speech = (input.speech ?? '').trim().slice(0, 2000)
  const respond = (reply: string, finish = false, capture = false) => {
    state.messages.push({ role: 'assistant', content: reply })
    return { state, reply, finish, capture }
  }
  if (previous.turns >= 12) return respond('I could not finish taking your message. Please call again during business hours.', true)
  if (previous.awaitingConfirmation && (input.digits === '1' || /^(yes|yes please|correct|that is correct|that's correct|confirm|confirmed)[.!]?$/i.test(speech))) {
    state.messages.push({ role: 'user', content: speech || 'Confirmed with keypad' })
    return respond('Thank you. Your callback request has been saved for our team. Goodbye.', true, true)
  }
  if (!speech && !input.digits) {
    state.silence++
    return state.silence >= 2
      ? respond('I did not hear a response, so no callback request was saved. Please call again. Goodbye.', true)
      : respond(previous.awaitingConfirmation ? 'Please say yes or press 1 to confirm, or tell me what to change.' : 'I did not hear you. Please tell me your name and how we can help.')
  }
  state.silence = 0
  state.awaitingConfirmation = false
  state.messages.push({ role: 'user', content: speech || `Keypad ${input.digits}` })
  let reply = ''
  if (!previous.fallbackField) {
    try {
      const extracted = receptionistExtractionSchema.parse(await generate(state, config))
      state.fullName = extracted.fullName ?? state.fullName
      state.phone = extracted.phone ?? state.phone
      state.reason = extracted.reason ?? state.reason
      reply = extracted.reply
    } catch {
      if (previous.awaitingConfirmation) {
        state.fullName = ''
        state.phone = ''
        state.reason = ''
      }
      state.fallbackField = !state.fullName ? 'fullName' : !state.phone ? 'phone' : 'reason'
      reply = 'I cannot answer questions right now, but I can take a callback message. '
    }
  } else if (speech || input.digits) {
    if (previous.fallbackField === 'phone') {
      const normalized = input.digits ? `+${input.digits}` : speech.replace(/^plus\s+/i, '+').replace(/[\s().-]/g, '')
      if (phoneSchema.safeParse(normalized).success) state.phone = normalized
    } else state[previous.fallbackField] = speech.slice(0, previous.fallbackField === 'fullName' ? 120 : 2000)
  }
  if (state.fullName && phoneSchema.safeParse(state.phone).success && state.reason) {
    state.awaitingConfirmation = true
    state.fallbackField = null
    const request = /[.!?]$/.test(state.reason) ? state.reason : `${state.reason}.`
    return respond(`I have your name as ${state.fullName}, your callback number as ${state.phone.split('').join(' ')}, and your request as: ${request} Is that correct? Say yes or press 1 to save your callback request, or tell me what to change.`)
  }
  if (state.fallbackField) {
    state.fallbackField = !state.fullName ? 'fullName' : !state.phone ? 'phone' : 'reason'
    const question = { fullName: 'What is your full name?', phone: 'Please enter your callback number including the country code, then press the hash key.', reason: 'What would you like the team to call you about?' }[state.fallbackField]
    return respond(reply + question)
  }
  return respond(reply || 'Please tell me your name, callback number, and how we can help.')
}
