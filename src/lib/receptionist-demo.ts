import { calendarExceptionsText, type CalendarException } from './business-calendar'
import { websiteCallbackInputSchema } from './website-receptionist'
import { CallbackTimeError, preferredTimeLabel, resolveCallbackTime, type CallbackCalendar, type PreferredTime } from './callback-time'

export interface DemoBusiness { name: string; hours: string | null; services: string | null; pricing: string | null; callbackHours?: CallbackCalendar }
export type DemoOutcome = 'reached' | 'no_answer' | 'retry'
type Draft = { fullName: string; phone: string; reason: string; preferredLocalTime: string }
export interface DemoState {
  messages: Array<{ role: 'visitor' | 'receptionist'; text: string }>
  draft: Draft
  requestedTime: PreferredTime | null
  confirmedTime: PreferredTime | null
  pendingConfirmedTime: PreferredTime | null
  staffLocalTime: string
  callbackStep: 'idle' | 'editing' | 'review' | 'confirmed'
  callbackConsent: boolean
  handoffStep: 'idle' | 'review' | 'created'
  handoffConsent: boolean
  outcome: DemoOutcome
  outcomeStep: 'idle' | 'review'
  outcomeConsent: boolean
  outcomes: DemoOutcome[]
  closed: boolean
  error: string
}
export type DemoAction =
  | { type: 'message'; text: string }
  | { type: 'edit_callback'; field: keyof Draft; value: string }
  | { type: 'callback_consent' | 'handoff_consent' | 'outcome_consent'; value: boolean }
  | { type: 'select_outcome'; value: DemoOutcome }
  | { type: 'edit_staff_time'; value: string }
  | { type: 'reset' | 'review_callback' | 'confirm_callback' | 'preview_handoff' | 'confirm_handoff' | 'preview_outcome' | 'confirm_outcome' }

export function demoHours(value: { timeZone: string; opensAt: string; closesAt: string; businessDays: number[]; calendarExceptions?: CalendarException[] }): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const time = (input: string) => { const [hour, minute] = input.split(':').map(Number); return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}` }
  return `${[...value.businessDays].sort().map(day => days[day]).join(', ')}, ${time(value.opensAt)} to ${time(value.closesAt)} (${value.timeZone})${value.calendarExceptions?.length ? `; Date-specific hours: ${calendarExceptionsText(value).replaceAll('\n', '; ')}` : ''}`
}
export function createDemoState(business: DemoBusiness): DemoState {
  return { messages: [{ role: 'receptionist', text: `Hello, you've reached ${business.name}. This is a prewritten demo. How can we help?` }], draft: { fullName: 'Jamie Example', phone: '+12025550123', reason: 'Ask about services and pricing.', preferredLocalTime: '' }, requestedTime: null, confirmedTime: null, pendingConfirmedTime: null, staffLocalTime: '', callbackStep: 'idle', callbackConsent: false, handoffStep: 'idle', handoffConsent: false, outcome: 'reached', outcomeStep: 'idle', outcomeConsent: false, outcomes: [], closed: false, error: '' }
}
function answer(state: DemoState, text: string): DemoState {
  return { ...state, messages: [...state.messages, { role: 'receptionist' as const, text }].slice(-40), error: '' }
}
function chosenDemoTime(state: DemoState, business: DemoBusiness): PreferredTime | null {
  if (!state.requestedTime) return null
  if (!business.callbackHours) throw new CallbackTimeError('Saved business callback hours are unavailable. Restart this demo after reviewing setup.')
  return resolveCallbackTime({ localTime: state.staffLocalTime || state.requestedTime.localTime, timeZone: business.callbackHours.timeZone, businessVersion: business.callbackHours.version }, business.callbackHours)
}
function checkedDemoTime(state: DemoState, business: DemoBusiness): PreferredTime | null {
  const selected = chosenDemoTime(state, business)
  if (JSON.stringify(selected) !== JSON.stringify(state.pendingConfirmedTime)) throw new CallbackTimeError('Callback timing changed. Preview the chosen time again.', 409)
  return selected
}
function timingError(state: DemoState, error: unknown): DemoState { return { ...state, error: error instanceof CallbackTimeError ? error.message : 'Choose a valid sample callback time.' } }
export function reduceDemo(state: DemoState, action: DemoAction, business: DemoBusiness): DemoState {
  switch (action.type) {
    case 'reset': return createDemoState(business)
    case 'message': {
      const text = action.text.trim()
      if (!text || text.length > 1000) return { ...state, error: 'Enter a sample question of 1 to 1,000 characters.' }
      const next = { ...state, messages: [...state.messages, { role: 'visitor' as const, text }].slice(-40) }
      if (/\b(call\s+me|call\s+back|(?:request|want|need|arrange|get)\s+(?:a\s+)?callback|callback\s+please)\b|^callback[.!?]?$/i.test(text)) {
        if (state.callbackStep !== 'idle') return answer(next, 'A simulated callback is already in progress below. Continue it or restart this demo.')
        return answer({ ...next, callbackStep: 'editing' }, 'Use the fictional details below, then review the simulated callback readback. No callback request will be submitted.')
      }
      if (/\b(pric\w*|cost\w*|fees?)\b/i.test(text)) return answer(next, business.pricing ? `Approved pricing excerpt for this demo:\n${business.pricing}` : 'Our team will confirm pricing. You can practice a callback request.')
      if (/\b(hours?|open\w*|clos\w*|when)\b/i.test(text)) return answer(next, business.hours ? `Staffed callback hours: ${business.hours}. A callback time is not guaranteed.` : 'Our team will confirm callback hours. You can practice a callback request.')
      if (/\b(services?|offer\w*|crm|features?)\b/i.test(text)) return answer(next, business.services ? `Approved services excerpt for this demo:\n${business.services}` : 'Our team will confirm the available services. You can practice a callback request.')
      return answer(next, 'This prewritten demo cannot answer that question. You can practice a callback request for the team to review.')
    }
    case 'edit_callback': {
      if (!['editing', 'review'].includes(state.callbackStep)) return state
      const maximum = { fullName: 120, phone: 30, reason: 1000, preferredLocalTime: 16 }[action.field]
      return { ...state, draft: { ...state.draft, [action.field]: action.value.slice(0, maximum) }, callbackStep: 'editing', callbackConsent: false, requestedTime: null, pendingConfirmedTime: null, staffLocalTime: '', error: '' }
    }
    case 'review_callback': {
      if (!['editing', 'review'].includes(state.callbackStep)) return state
      const parsed = websiteCallbackInputSchema.safeParse({ fullName: state.draft.fullName, phone: state.draft.phone, reason: state.draft.reason, confirmed: true, website: '' })
      if (!parsed.success) return { ...state, callbackStep: 'editing', callbackConsent: false, error: 'Enter a sample name, valid international phone number, and callback reason.' }
      const { fullName, phone, reason } = parsed.data
      let requestedTime: PreferredTime | null = null
      try {
        if (state.draft.preferredLocalTime) {
          if (!business.callbackHours) throw new CallbackTimeError('Saved business callback hours are unavailable.')
          requestedTime = resolveCallbackTime({ localTime: state.draft.preferredLocalTime, timeZone: business.callbackHours.timeZone, businessVersion: business.callbackHours.version }, business.callbackHours)
        }
      } catch (error) { return timingError({ ...state, callbackStep: 'editing', callbackConsent: false, requestedTime: null }, error) }
      return answer({ ...state, draft: { fullName, phone, reason, preferredLocalTime: state.draft.preferredLocalTime }, requestedTime, staffLocalTime: requestedTime?.localTime ?? '', callbackStep: 'review', callbackConsent: false }, `Simulated readback: ${fullName} · ${phone} · ${reason}.${requestedTime ? ` Requested callback time: ${preferredTimeLabel(requestedTime)}.` : ''} Confirm the fictional details below.`)
    }
    case 'callback_consent': return state.callbackStep === 'review' ? { ...state, callbackConsent: action.value } : state
    case 'confirm_callback': {
      if (state.callbackStep !== 'review' || !state.callbackConsent) return state
      try { if (state.requestedTime) { if (!business.callbackHours) throw new CallbackTimeError('Saved callback hours are unavailable.'); const { at: _at, ...selection } = state.requestedTime; resolveCallbackTime(selection, business.callbackHours) } }
      catch (error) { return timingError({ ...state, callbackStep: 'editing', callbackConsent: false, requestedTime: null }, error) }
      return answer({ ...state, callbackStep: 'confirmed', callbackConsent: false }, 'Simulated callback confirmed. No real request was submitted. You can now practice a CRM handoff.')
    }
    case 'edit_staff_time': return state.callbackStep === 'confirmed' && !state.closed ? { ...state, staffLocalTime: action.value.slice(0, 16), handoffStep: state.handoffStep === 'created' ? 'created' : 'idle', handoffConsent: false, outcomeStep: 'idle', outcomeConsent: false, pendingConfirmedTime: null, error: '' } : state
    case 'preview_handoff': {
      if (state.callbackStep !== 'confirmed' || state.handoffStep !== 'idle') return state
      try { return { ...state, pendingConfirmedTime: chosenDemoTime(state, business), handoffStep: 'review', handoffConsent: false, error: '' } }
      catch (error) { return timingError(state, error) }
    }
    case 'handoff_consent': return state.handoffStep === 'review' ? { ...state, handoffConsent: action.value } : state
    case 'confirm_handoff': {
      if (state.handoffStep !== 'review' || !state.handoffConsent) return state
      try { const confirmedTime = checkedDemoTime(state, business); return answer({ ...state, handoffStep: 'created', handoffConsent: false, confirmedTime, pendingConfirmedTime: null }, 'Simulated CRM handoff complete. One demo lead and one demo callback task are shown below. Nothing was saved to CRM.') }
      catch (error) { return timingError({ ...state, handoffStep: 'idle', handoffConsent: false, pendingConfirmedTime: null }, error) }
    }
    case 'select_outcome': return state.handoffStep === 'created' && !state.closed ? { ...state, outcome: action.value, outcomeStep: 'idle', outcomeConsent: false, pendingConfirmedTime: null } : state
    case 'preview_outcome': {
      if (state.handoffStep !== 'created' || state.closed) return state
      try { return { ...state, pendingConfirmedTime: state.outcome === 'retry' ? chosenDemoTime(state, business) : null, outcomeStep: 'review', outcomeConsent: false, error: '' } }
      catch (error) { return timingError(state, error) }
    }
    case 'outcome_consent': return state.outcomeStep === 'review' ? { ...state, outcomeConsent: action.value } : state
    case 'confirm_outcome': {
      if (state.outcomeStep !== 'review' || !state.outcomeConsent || state.closed) return state
      if (state.outcome === 'retry') { try { checkedDemoTime(state, business) } catch (error) { return timingError({ ...state, outcomeStep: 'idle', outcomeConsent: false, pendingConfirmedTime: null }, error) } }
      const closed = state.outcome === 'reached'
      return answer({ ...state, closed, outcomeStep: 'idle', outcomeConsent: false, confirmedTime: state.pendingConfirmedTime ?? state.confirmedTime, pendingConfirmedTime: null, outcomes: [...state.outcomes, state.outcome].slice(-20) }, closed ? 'Simulated outcome: reached. The demo callback and task are closed.' : `Simulated outcome: ${state.outcome === 'no_answer' ? 'no answer' : 'retry requested'}. The demo callback and task stay open for another attempt.`)
    }
  }
}
